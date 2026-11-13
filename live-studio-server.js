"use strict";
const crypto = require("crypto");
const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { TRACK_SOURCE, CHANNEL_PINNED_MESSAGE_TYPE, pinNoticeTargetId, isBotPinActorNotice, isRadarPinNotice, isValidInviteCode, inviteDigest, cleanName, safeTrackSource, trackFlags, normalizeDurationMinutes, safeOrigin, shouldUseTextChannel, isTicketChannel, buildRadarMessage } = require("./live-studio-core");
const { normalizeAiPlan, buildOverwriteEdit, bitfieldToRestorePayload, overwriteState } = require("./role-permissions");
const { readDiscordServerRules } = require("./discord-server-rules");
const { classifyBusinessRoles } = require("./discord-business-role-classifier");

function attachLiveStudioServer({ app, client, db, guildId, verifyAdminApiRequest, checkCppRateLimit, ChannelType, allowedOrigins, setLivePresence = () => {}, getChannelAdminRoleIds = () => [], getCompensationConfig = () => ({}), aiChat = null }) {
  const sessions = new Map();
  const invites = new Map();
  const activity = [];
  const panelOriginFallback = String(process.env.ADMIN_PANEL_DEFAULT_ORIGIN || "https://admin-9x7v1.wuaze.com").trim().replace(/\/+$/, "");
  const liveRoomBaseOrigin = (() => {
    const raw = String(process.env.LIVE_STUDIO_PUBLIC_BASE_URL || "https://liveuseradmin9x.blogspot.com").trim();
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Expected an HTTPS origin only");
      return url.origin;
    } catch (_) {
      console.warn("LIVE_STUDIO_PUBLIC_BASE_URL must be the Blogger HTTPS origin only; using https://liveuseradmin9x.blogspot.com");
      return "https://liveuseradmin9x.blogspot.com";
    }
  })();
  const maxParticipants = Math.max(2, Math.min(100, Number(process.env.LIVE_STUDIO_MAX_PARTICIPANTS || 20)));
  const defaultDurationMinutes = normalizeDurationMinutes(process.env.LIVE_STUDIO_DEFAULT_DURATION_MINUTES || 60);
  const maxInviteUses = Math.max(maxParticipants, Math.min(100000, Number(process.env.LIVE_STUDIO_MAX_INVITE_USES || 10000)));
  const radarRefPath = "runtime/liveStreamRadar";
  const pinsRefPath = "runtime/liveStreamRadarPins";
  const channelLocksRefPath = "runtime/liveStreamRadarChannelLocks";
  const persistedSessionRefPath = "runtime/liveStreamRadarSession";
  // Radar messages continue to be posted/edited while live, but are never pinned.
  const postRadarToTextChannels = String(process.env.LIVE_STREAM_RADAR_TEXT_CHANNELS ?? "true").toLowerCase() !== "false";
  const denyMentions = { parse: [] };
  let liveKitRuntime = null, radarBusy = false, pinBusy = false, lastRadarFingerprint = "", cleanupRequested = true, botPinSweepSessionId = "";
  let startupRecoveryComplete = false, startupRecoveryPromise = null;
  const botPinSweepBusyChannels = new Set();
  function setLivePresenceSafely(active) {
    try { setLivePresence(Boolean(active)); }
    catch (err) { console.warn("Live Studio profile activity update failed:", String(err?.message || err).slice(0, 160)); }
  }

  // The AI can only suggest channel-scoped permissions from this allowlist. It can
  // never edit guild-wide Administrator/Manage Roles/Manage Guild permissions.
  const ROLE_PERMISSION_TEXT_NAMES = [
    "ViewChannel", "SendMessages", "ReadMessageHistory", "AddReactions", "EmbedLinks",
    "AttachFiles", "UseExternalEmojis", "MentionEveryone", "ManageMessages", "ManageThreads",
    "CreatePublicThreads", "CreatePrivateThreads", "SendMessagesInThreads", "UseApplicationCommands", "SendPolls"
  ];
  const ROLE_PERMISSION_VOICE_NAMES = [
    "ViewChannel", "Connect", "Speak", "Stream", "UseVAD", "PrioritySpeaker",
    "MuteMembers", "DeafenMembers", "MoveMembers", "UseSoundboard", "UseExternalSounds", "UseEmbeddedActivities"
  ];
  const ROLE_PERMISSION_BACKUP_PATH = "runtime/rolePermissionBackups";
  const MANUAL_CHANNEL_PRIVACY_PATH = "runtime/manualChannelPrivacy";
  const MEMBER_COUNTER_PATH = "runtime/memberCountChannel";
  const STAFF_PERFORMANCE_PATH = "staffPerformanceEvents";
  const STAFF_PAYOUTS_PATH = "staffPayouts";
  const RESELLER_RATES_PATH = "runtime/resellerCommissionRates";
  const ROLE_AUTOMATION_PATH = "adminConfig/bot/roleAutomation";
  const MEMBER_ROLE_AUTOMATION_PATH = "runtime/memberRoleAutomation";
  const AI_OPERATIONS_PATH = "runtime/aiOperations";
  const pendingRolePermissionPlans = new Map();

  function supportedChannelPermissionNames(channel) {
    if (!channel || channel.isThread?.()) return [];
    const types = ChannelType || {};
    const textTypes = [types.GuildText, types.GuildAnnouncement, types.GuildForum, types.GuildMedia].filter(Number.isInteger);
    const voiceTypes = [types.GuildVoice, types.GuildStageVoice].filter(Number.isInteger);
    let names = [];
    if (channel.type === types.GuildCategory) names = [...new Set([...ROLE_PERMISSION_TEXT_NAMES, ...ROLE_PERMISSION_VOICE_NAMES])];
    else if (textTypes.includes(channel.type)) names = ROLE_PERMISSION_TEXT_NAMES;
    else if (voiceTypes.includes(channel.type)) names = ROLE_PERMISSION_VOICE_NAMES;
    return names.filter(name => PermissionFlagsBits[name] !== undefined);
  }

  function manualPrivacyPermissionNames(channel) {
    if (!channel || channel.isThread?.()) return [];
    const type = ChannelType || {};
    const textTypes = [type.GuildText, type.GuildAnnouncement, type.GuildForum, type.GuildMedia].filter(Number.isInteger);
    const voiceTypes = [type.GuildVoice, type.GuildStageVoice].filter(Number.isInteger);
    if (textTypes.includes(channel.type)) return ["ViewChannel", "ReadMessageHistory", "SendMessages", "AddReactions", "CreatePublicThreads", "CreatePrivateThreads", "SendMessagesInThreads", "UseApplicationCommands", "SendPolls"].filter(name => PermissionFlagsBits[name] !== undefined);
    if (voiceTypes.includes(channel.type)) return ["ViewChannel", "Connect", "Speak", "Stream", "UseVAD", "UseSoundboard", "UseExternalSounds", "UseEmbeddedActivities"].filter(name => PermissionFlagsBits[name] !== undefined);
    return [];
  }

  function privacyChannelType(channel) {
    const type = ChannelType || {};
    if ([type.GuildVoice, type.GuildStageVoice].includes(channel?.type)) return "voice";
    if (channel?.type === type.GuildForum || channel?.type === type.GuildMedia) return "forum";
    if (channel?.type === type.GuildAnnouncement) return "announcement";
    return "text";
  }

  function isPubliclyVisibleChannel(channel, guild) {
    return Boolean(channel?.permissionsFor?.(guild?.roles?.everyone)?.has?.(PermissionFlagsBits.ViewChannel));
  }

  function overwritePermissionStates(channel, targetId, permissionNames) {
    const overwrite = channel.permissionOverwrites?.cache?.get(String(targetId)) || null;
    return Object.fromEntries(permissionNames.map(name => [name, overwriteState(overwrite, name, PermissionFlagsBits)]));
  }

  function privacyLockPayload(channel) {
    const type = privacyChannelType(channel);
    const payload = {};
    if (type === "voice") {
      Object.assign(payload, { Connect: false, Speak: false, Stream: false, UseVAD: false, UseSoundboard: false, UseExternalSounds: false, UseEmbeddedActivities: false });
    } else {
      Object.assign(payload, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false, UseApplicationCommands: false, SendPolls: false });
    }
    return Object.fromEntries(Object.entries(payload).filter(([name]) => PermissionFlagsBits[name] !== undefined));
  }

  function privacyAdminAllowPayload(channel) {
    const type = privacyChannelType(channel);
    const payload = {};
    if (type === "voice") Object.assign(payload, { Connect: true, Speak: true, Stream: true, UseVAD: true });
    else Object.assign(payload, { SendMessages: true, AddReactions: true, CreatePublicThreads: true, CreatePrivateThreads: true, SendMessagesInThreads: true, UseApplicationCommands: true, SendPolls: true });
    return Object.fromEntries(Object.entries(payload).filter(([name]) => PermissionFlagsBits[name] !== undefined));
  }

  async function getManualPrivacyContext(channelIdValue) {
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
    await guild.roles.fetch().catch(() => {});
    const channelId = validateDiscordSnowflake(channelIdValue, "Channel");
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    const permissionNames = manualPrivacyPermissionNames(channel);
    if (!channel || channel.guildId !== guild.id || permissionNames.length === 0) throw Object.assign(new Error("Choose a text, announcement, forum, voice or stage channel"), { statusCode: 404, apiError: "discord_privacy_channel_not_found" });
    if (!isPubliclyVisibleChannel(channel, guild)) throw Object.assign(new Error("This channel is private to selected roles. Manual read-only only applies to channels everyone can already view."), { statusCode: 403, apiError: "discord_privacy_channel_private" });
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const permissions = botMember && channel.permissionsFor(botMember);
    if (!permissions || !permissions.has(PermissionFlagsBits.ManageRoles) || !permissions.has(PermissionFlagsBits.ViewChannel)) throw Object.assign(new Error("Bot needs View Channel and Manage Roles on the selected channel"), { statusCode: 403, apiError: "discord_bot_manage_roles_missing" });
    return { guild, channel, permissionNames, botMember };
  }

  function getPrivacyAdminRoleConfig(guild, botMember) {
    const configuredRoleIds = new Set((Array.isArray(getChannelAdminRoleIds(guild)) ? getChannelAdminRoleIds(guild) : []).map(String).filter(id => /^\d{15,22}$/.test(id)));
    const protectedRoleIds = new Set([...guild.roles.cache.values()].filter(role => role.permissions.has(PermissionFlagsBits.ManageChannels)).map(role => role.id));
    for (const id of configuredRoleIds) protectedRoleIds.add(id);
    const adminRoles = [...guild.roles.cache.values()].filter(role => role.id !== guild.id && !role.managed && role.position < botMember.roles.highest.position && !role.permissions.has(PermissionFlagsBits.Administrator) && (role.permissions.has(PermissionFlagsBits.ManageChannels) || configuredRoleIds.has(role.id)));
    return { adminRoles, protectedRoleIds };
  }

  function overwriteAllowsAny(overwrite, permissionNames) {
    return permissionNames.some(name => PermissionFlagsBits[name] !== undefined && overwrite?.allow?.has?.(PermissionFlagsBits[name]));
  }

  async function getManualPrivacyTargets(guild, channel, botMember, permissionNames, adminRoles, protectedRoleIds) {
    const adminRoleIds = new Set(adminRoles.map(role => role.id));
    const botId = String(client.user?.id || botMember.id);
    const targets = new Set([String(guild.id), botId, ...adminRoleIds]);
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      const targetId = String(overwrite.id);
      if (targets.has(targetId) || !overwriteAllowsAny(overwrite, permissionNames)) continue;
      const role = guild.roles.cache.get(targetId);
      if (role) {
        if (role.permissions.has(PermissionFlagsBits.Administrator) || protectedRoleIds.has(role.id)) continue;
        targets.add(targetId);
        continue;
      }
      let member = guild.members.cache.get(targetId) || null;
      if (!member) member = await guild.members.fetch(targetId).catch(() => null);
      if (!member || member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some(memberRole => protectedRoleIds.has(memberRole.id))) continue;
      targets.add(targetId);
    }
    return [...targets];
  }

  async function restoreManualPrivacy(channel, snapshot, actorUid) {
    for (const [targetId, states] of Object.entries(snapshot?.targets || {})) {
      const current = channel.permissionOverwrites.cache.get(targetId);
      if (!current) continue;
      const payload = Object.fromEntries(Object.entries(states || {}).map(([name, state]) => [name, state === "allow" ? true : state === "deny" ? false : null]));
      await channel.permissionOverwrites.edit(targetId, payload, { reason: `Restore saved channel privacy state via Admin Panel by ${actorUid}` });
    }
  }

  function isVoiceCounterChannel(channel) {
    const types = ChannelType || {};
    return Boolean(channel && channel.type === types.GuildVoice);
  }

  function counterChannelName(template, count) {
    const safeTemplate = String(template || "members-{count}").trim().slice(0, 90) || "members-{count}";
    const name = safeTemplate.replace(/\{(?:members|count)\}/gi, String(Math.max(0, Number(count) || 0)))
      .toLowerCase().replace(/[^\p{L}\p{N}_ -]+/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 95);
    return name || `members-${Math.max(0, Number(count) || 0)}`;
  }

  async function getMemberCounterChannel(channelIdValue) {
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
    await guild.roles.fetch().catch(() => {});
    const channelId = validateDiscordSnowflake(channelIdValue, "Voice channel");
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id || !isVoiceCounterChannel(channel)) throw Object.assign(new Error("Choose a Discord voice channel"), { statusCode: 404, apiError: "member_counter_voice_channel_not_found" });
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const permissions = botMember && channel.permissionsFor(botMember);
    if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ManageChannels) || !permissions.has(PermissionFlagsBits.ManageRoles)) throw Object.assign(new Error("Bot needs View Channel, Manage Channels and Manage Roles for the counter voice channel"), { statusCode: 403, apiError: "discord_bot_manage_roles_missing" });
    return { guild, channel, botMember };
  }

  async function memberCounterConnectTargets(guild, channel, botMember) {
    const targets = new Set([String(guild.id)]);
    const protectedRoleIds = new Set((Array.isArray(getChannelAdminRoleIds(guild)) ? getChannelAdminRoleIds(guild) : []).map(String));
    for (const role of guild.roles.cache.values()) if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageChannels)) protectedRoleIds.add(role.id);
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      const targetId = String(overwrite.id);
      if (targetId === String(guild.id) || !overwrite.allow?.has?.(PermissionFlagsBits.Connect)) continue;
      const role = guild.roles.cache.get(targetId);
      if (role) {
        if (!protectedRoleIds.has(targetId)) targets.add(targetId);
        continue;
      }
      let member = guild.members.cache.get(targetId) || null;
      if (!member) member = await guild.members.fetch(targetId).catch(() => null);
      if (member && !member.permissions.has(PermissionFlagsBits.Administrator) && !member.roles.cache.some(memberRole => protectedRoleIds.has(memberRole.id)) && member.id !== botMember.id) targets.add(targetId);
    }
    return [...targets];
  }

  async function restoreMemberCounterChannel(snapshot, actorUid = "Bot recovery") {
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild || !snapshot?.channelId) return false;
    const channel = guild.channels.cache.get(String(snapshot.channelId)) || await guild.channels.fetch(String(snapshot.channelId)).catch(() => null);
    if (!channel || !isVoiceCounterChannel(channel)) return false;
    for (const [targetId, state] of Object.entries(snapshot.originalConnectStates || {})) {
      const current = channel.permissionOverwrites.cache.get(targetId);
      if (!current) continue;
      await channel.permissionOverwrites.edit(targetId, { Connect: state === "allow" ? true : state === "deny" ? false : null }, { reason: `Restore previous member counter channel access (${actorUid})` });
    }
    if (snapshot.originalName && channel.name !== snapshot.originalName) await channel.setName(String(snapshot.originalName).slice(0, 100), `Restore previous member counter channel name (${actorUid})`);
    return true;
  }

  async function updateMemberCounterName() {
    const current = (await db.ref(MEMBER_COUNTER_PATH).once("value").catch(() => null))?.val() || null;
    if (!current?.enabled || current.status !== "active") return;
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) return;
    const channel = guild.channels.cache.get(String(current.channelId)) || await guild.channels.fetch(String(current.channelId)).catch(() => null);
    if (!channel || !isVoiceCounterChannel(channel)) return;
    const count = Math.max(0, Number(guild.memberCount) || guild.members.cache.size || 0);
    const nextName = counterChannelName(current.template, count);
    if (channel.name !== nextName) await channel.setName(nextName, "Update Admin Panel server member counter");
    await db.ref(MEMBER_COUNTER_PATH).update({ memberCount: count, displayedName: nextName, updatedAt: Date.now() }).catch(() => {});
  }

  async function restoreCounterBeforeSwitch(previous, actorUid) {
    if (!previous?.enabled || !previous.channelId || !previous.originalConnectStates) return;
    await restoreMemberCounterChannel(previous, actorUid);
  }

  function rolePermissionChannelType(channel) {
    if (!channel) return "Unknown";
    const types = ChannelType || {};
    if (channel.type === types.GuildCategory) return "Category (synced child channels may inherit)";
    if (channel.type === types.GuildVoice || channel.type === types.GuildStageVoice) return "Voice / Stage";
    if (channel.type === types.GuildForum || channel.type === types.GuildMedia) return "Forum / Media";
    if (channel.type === types.GuildAnnouncement) return "Announcement";
    if (channel.type === types.GuildText) return "Text";
    return "Unsupported";
  }

  function validateDiscordSnowflake(value, label) {
    const id = String(value || "").trim();
    if (!/^\d{15,22}$/.test(id)) throw Object.assign(new Error(`${label} ID is invalid`), { statusCode: 400, apiError: "invalid_role_permission_target" });
    return id;
  }

  async function getRolePermissionContext(roleIdValue, channelIdValue) {
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) throw Object.assign(new Error("Configured Discord guild is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
    const roleId = validateDiscordSnowflake(roleIdValue, "Role");
    const channelId = validateDiscordSnowflake(channelIdValue, "Channel");
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.guild.id !== guild.id) throw Object.assign(new Error("The selected role was not found in this Discord server"), { statusCode: 404, apiError: "discord_role_not_found" });
    if (role.managed) throw Object.assign(new Error("Integration-managed roles cannot be edited here"), { statusCode: 400, apiError: "role_permission_role_not_editable" });
    if (role.permissions.has(PermissionFlagsBits.Administrator)) throw Object.assign(new Error("This role already has Administrator. Channel overwrites cannot restrict Administrator roles; edit the role's base permissions in Discord instead."), { statusCode: 400, apiError: "role_permission_admin_role_unaffected" });
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id) throw Object.assign(new Error("The selected channel was not found in this Discord server"), { statusCode: 404, apiError: "discord_channel_not_found" });
    const allowedPermissions = supportedChannelPermissionNames(channel);
    if (!allowedPermissions.length) throw Object.assign(new Error("This channel type is not supported. Choose a text, announcement, forum, voice, stage or category channel."), { statusCode: 400, apiError: "unsupported_role_permission_channel" });
    return { guild, role, channel, allowedPermissions };
  }

  function currentRoleOverwriteStates(channel, roleId, allowedPermissions) {
    const overwrite = channel.permissionOverwrites?.cache?.get(String(roleId)) || null;
    return Object.fromEntries(allowedPermissions.map(permission => [permission, overwriteState(overwrite, permission, PermissionFlagsBits)]));
  }

  async function askOpenAiForRolePermissionPlan({ role, channel, goal, allowedPermissions, currentStates }) {
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) throw Object.assign(new Error("AI is not configured yet. Set OPENAI_API_KEY on the private Bot host, then restart/redeploy the Bot."), { statusCode: 503, apiError: "role_permission_ai_not_configured" });
    const model = String(process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini").trim().slice(0, 80);
    const schema = {
      type: "object", additionalProperties: false,
      properties: {
        summary: { type: "string" },
        rationale: { type: "string" },
        changes: { type: "array", items: {
          type: "object", additionalProperties: false,
          properties: {
            permission: { type: "string", enum: allowedPermissions },
            state: { type: "string", enum: ["allow", "deny", "keep"] },
            reason: { type: "string" }
          }, required: ["permission", "state", "reason"]
        } }
      }, required: ["summary", "rationale", "changes"]
    };
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          model,
          instructions: "You are a cautious Discord channel permission planner. Return only a plan matching the supplied JSON schema. The user is an authorized server admin, but your output is only a proposal that will be reviewed and approved by that admin before application. Use only the supplied allowedPermissions. Never propose Administrator, ManageRoles, ManageGuild, ManageWebhooks, or any guild-wide privilege. For every allowed permission choose allow, deny, or keep. Prefer least privilege. Use keep when the goal does not require changing a permission. Consider current role overwrite states and the requested channel context. Explain each proposed state briefly. Do not claim the plan has been applied.",
          input: JSON.stringify({
            task: "Prepare a role-specific channel permission overwrite proposal.",
            guildId: String(guildId),
            role: { id: role.id, name: role.name, position: role.position },
            channel: { id: channel.id, name: channel.name, type: rolePermissionChannelType(channel), parentCategory: channel.parent?.name || "" },
            userGoal: goal,
            allowedPermissions,
            existingRoleOverwriteStates: currentStates,
            stateMeaning: { allow: "explicitly allow for this role in this channel", deny: "explicitly deny for this role in this channel", keep: "do not change the existing overwrite for this permission" }
          }),
          text: { format: { type: "json_schema", name: "discord_role_permission_plan", strict: true, schema } },
          max_output_tokens: 1800
        })
      });
    } catch (err) {
      throw Object.assign(new Error("Could not reach the AI permission planner. Try again shortly."), { statusCode: 502, apiError: "role_permission_ai_unavailable" });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn("AI role permission request failed with HTTP", response.status);
      throw Object.assign(new Error("AI permission planning failed. Check the Bot host API key, model name, and provider quota."), { statusCode: 502, apiError: "role_permission_ai_provider_error" });
    }
    const outputText = Array.isArray(payload?.output)
      ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("\n")
      : "";
    if (!outputText) throw Object.assign(new Error("AI did not return a readable permission plan. Try again."), { statusCode: 502, apiError: "role_permission_ai_invalid_response" });
    let value;
    try { value = JSON.parse(outputText); }
    catch (_) { throw Object.assign(new Error("AI response was not valid structured data. Try again."), { statusCode: 502, apiError: "role_permission_ai_invalid_response" }); }
    return normalizeAiPlan(value, allowedPermissions);
  }

  function pruneRolePermissionPlans() {
    const now = Date.now();
    for (const [id, plan] of pendingRolePermissionPlans) if (!plan || plan.expiresAt <= now) pendingRolePermissionPlans.delete(id);
    while (pendingRolePermissionPlans.size > 100) pendingRolePermissionPlans.delete(pendingRolePermissionPlans.keys().next().value);
  }

  async function requireRolePermissionBotAccess(guild, channel, role) {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) throw Object.assign(new Error("Bot member is unavailable in this guild"), { statusCode: 503, apiError: "discord_bot_member_unavailable" });
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) && !botMember.permissions.has(PermissionFlagsBits.Administrator)) {
      throw Object.assign(new Error("Bot needs Manage Roles permission to edit channel permission overwrites"), { statusCode: 403, apiError: "discord_bot_manage_roles_missing" });
    }
    const channelPermissions = channel.permissionsFor(botMember);
    if (!channelPermissions || (!channelPermissions.has(PermissionFlagsBits.ManageRoles) && !channelPermissions.has(PermissionFlagsBits.Administrator))) {
      throw Object.assign(new Error("Bot does not have Manage Roles permission in this channel"), { statusCode: 403, apiError: "discord_bot_manage_roles_missing" });
    }
  }

  function config() {
    const liveKitUrl = String(process.env.LIVEKIT_URL || "").trim().replace(/\/+$/, "");
    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
    const missingVariables = [];
    if (!liveKitUrl) missingVariables.push("LIVEKIT_URL");
    if (!apiKey) missingVariables.push("LIVEKIT_API_KEY");
    if (!apiSecret) missingVariables.push("LIVEKIT_API_SECRET");
    let httpUrl = "";
    try { const url = new URL(liveKitUrl); if (url.protocol === "wss:") url.protocol = "https:"; else if (url.protocol === "ws:") url.protocol = "http:"; if (!/^https?:$/.test(url.protocol)) throw new Error("invalid protocol"); httpUrl = url.toString().replace(/\/$/, ""); }
    catch (_) { if (liveKitUrl) missingVariables.push("valid LIVEKIT_URL"); }
    return { liveKitUrl, httpUrl, apiKey, apiSecret, missingVariables, configured: missingVariables.length === 0 };
  }
  function runtime() {
    const cfg = config();
    if (!cfg.configured) throw Object.assign(new Error("LiveKit configuration is missing"), { statusCode: 503, apiError: "livekit_not_configured", missingVariables: cfg.missingVariables });
    if (!liveKitRuntime) {
      const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
      liveKitRuntime = { ...cfg, AccessToken, roomService: new RoomServiceClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret) };
    }
    return liveKitRuntime;
  }
  function addActivity(type, summary, extra = {}) {
    const entry = { id: crypto.randomBytes(6).toString("hex"), type: String(type).slice(0, 40), summary: String(summary || "").replace(/[\r\n\0]+/g, " ").slice(0, 200), at: Date.now(), ...extra };
    activity.unshift(entry); if (activity.length > 40) activity.length = 40; return entry;
  }
  function activeSession() {
    const session = sessions.get(guildId);
    return session && !session.endedAt && session.expiresAt > Date.now() ? session : null;
  }
  // ---- AKMAFIA YT AI Management (বেস্ট-existing panel-এর ভেতরেই, নতুন প্যানেল নয়) ----
  function aiChatRuntime() { return aiChat; }
  function aiRouterRuntime() { return aiChat?.router || null; }
  function requireAiRouter() {
    const router = aiRouterRuntime();
    if (!router) throw Object.assign(new Error("AI router এখনো চালু হয়নি; বট restart করার পর আবার চেষ্টা করুন"), { statusCode: 503, apiError: "ai_router_unavailable" });
    return router;
  }
  async function writeAiAudit(actor, actionType, summary) {
    await db.ref("auditLog").push({ adminUid: actor?.uid || "unknown", actionType, timestamp: Date.now(), summary: String(summary).slice(0, 300) }).catch(() => {});
  }

  function apiError(res, err, fallback = "live_studio_error") {
    const status = Number(err?.statusCode) || 500;
    if (status >= 500) console.error("Live Studio API error:", String(err?.apiError || fallback), String(err?.message || "unknown").replace(/[\r\n\0]+/g, " ").slice(0, 220));
    return res.status(status).json({ ok: false, error: String(err?.apiError || fallback), message: String(err?.message || "Request failed").slice(0, 260), ...(Array.isArray(err?.missingVariables) ? { missingVariables: err.missingVariables } : {}) });
  }
  function allowedPanelOrigin(req, requestedOrigin) {
    const origin = String(requestedOrigin || req.get("origin") || "");
    const fallback = (() => { try { return new URL(panelOriginFallback).origin; } catch (_) { return "https://admin-9x7v1.wuaze.com"; } })();
    return safeOrigin(origin, allowedOrigins, fallback);
  }
  async function createAccessToken(session, identity, name, role) {
    const rt = runtime();
    const token = new rt.AccessToken(rt.apiKey, rt.apiSecret, {
      identity: String(identity).slice(0, 120), name: cleanName(name),
      ttl: Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000)),
      metadata: JSON.stringify({ app: "RKBACKLES", sessionId: session.sessionId, role })
    });
    // LiveKit's TrackSource is a numeric protobuf enum: microphone=2, screen_share=3,
    // screen_share_audio=4. Do NOT pass the strings "microphone" etc. in grants.
    const allowedSources = role === "guest" && session.muteAllActive
      ? [TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO]
      : [TRACK_SOURCE.MICROPHONE, TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO];
    token.addGrant({ roomJoin: true, room: session.roomName, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: allowedSources });
    return { token: await token.toJwt(), serverUrl: rt.liveKitUrl };
  }
  function makeInvite(session) {
    const code = crypto.randomBytes(32).toString("base64url");
    const expiresAt = session.expiresAt;
    invites.set(inviteDigest(code), { code, sessionId: session.sessionId, expiresAt, uses: 0, maxUses: maxInviteUses, createdAt: Date.now() });
    session.inviteCode = code;
    session.inviteUrl = `${session.publicOrigin}/?invite=${encodeURIComponent(code)}`;
    session.inviteExpiresAt = expiresAt;
    return { inviteCode: code, inviteUrl: session.inviteUrl, expiresAt, maxUses: maxInviteUses };
  }
  async function persistSessionSnapshot(session) {
    if (!session) return;
    const inviteRecords = [...invites.values()]
      .filter(invite => invite.sessionId === session.sessionId && isValidInviteCode(invite.code) && invite.expiresAt > Date.now())
      .map(invite => ({ code: invite.code, sessionId: invite.sessionId, expiresAt: invite.expiresAt, uses: invite.uses, maxUses: invite.maxUses, createdAt: invite.createdAt }));
    const record = {
      schemaVersion: 1,
      guildId: String(guildId),
      sessionId: String(session.sessionId),
      roomName: String(session.roomName),
      ownerUid: String(session.ownerUid || "system"),
      startedAt: Number(session.startedAt) || Date.now(),
      expiresAt: Number(session.expiresAt) || 0,
      durationMinutes: normalizeDurationMinutes(session.durationMinutes),
      publicOrigin: liveRoomBaseOrigin,
      adminPanelOrigin: String(session.adminPanelOrigin || panelOriginFallback),
      hostIdentity: String(session.hostIdentity || ""),
      inviteUrl: String(session.inviteUrl || ""),
      inviteExpiresAt: Number(session.inviteExpiresAt) || Number(session.expiresAt) || 0,
      inviteRecords,
      muteAllActive: Boolean(session.muteAllActive),
      mutedIdentities: [...(session.mutedIdentities || [])].filter(id => typeof id === "string" && id.startsWith("guest_")).slice(0, maxParticipants)
    };
    await db.ref(persistedSessionRefPath).set(record);
  }
  async function removePersistedSession(sessionId = "") {
    const ref = db.ref(persistedSessionRefPath);
    if (!sessionId) { await ref.remove(); return; }
    await ref.transaction(current => current && String(current.sessionId || "") === String(sessionId) ? null : current, undefined, false);
  }
  async function restorePersistedSessionOnStartup() {
    if (startupRecoveryComplete) return;
    if (startupRecoveryPromise) return startupRecoveryPromise;
    startupRecoveryPromise = (async () => {
      const snapshot = await db.ref(persistedSessionRefPath).once("value");
      const saved = snapshot.val();
      if (!saved || String(saved.guildId || "") !== String(guildId) || !saved.sessionId || !saved.roomName || !saved.hostIdentity || !Number.isFinite(Number(saved.expiresAt))) {
        if (saved) await removePersistedSession().catch(() => {});
        startupRecoveryComplete = true;
        return;
      }
      const expiresAt = Number(saved.expiresAt);
      if (expiresAt <= Date.now()) {
        // Expired sessions should not keep any channel locked. Delete the stale room when LiveKit is configured.
        try { await runtime().roomService.deleteRoom(String(saved.roomName)).catch(() => {}); } catch (_) {}
        await removePersistedSession(String(saved.sessionId)).catch(() => {});
        startupRecoveryComplete = true;
        return;
      }
      // Keep retrying if LiveKit configuration/network is unavailable instead of wrongly treating a live room as offline.
      const rt = runtime();
      const rooms = await rt.roomService.listRooms([String(saved.roomName)]);
      const roomExists = Array.isArray(rooms) && rooms.some(room => String(room.name || "") === String(saved.roomName));
      if (!roomExists) {
        await removePersistedSession(String(saved.sessionId)).catch(() => {});
        startupRecoveryComplete = true;
        return;
      }
      const session = {
        sessionId: String(saved.sessionId), guildId: String(guildId), roomName: String(saved.roomName),
        roomService: rt.roomService, ownerUid: String(saved.ownerUid || "system"),
        startedAt: Number(saved.startedAt) || Date.now(), expiresAt,
        durationMinutes: normalizeDurationMinutes(saved.durationMinutes), publicOrigin: liveRoomBaseOrigin,
        adminPanelOrigin: String(saved.adminPanelOrigin || panelOriginFallback), hostIdentity: String(saved.hostIdentity),
        inviteCode: "", inviteUrl: "", inviteExpiresAt: expiresAt,
        mutedIdentities: new Set(Array.isArray(saved.mutedIdentities) ? saved.mutedIdentities.filter(id => typeof id === "string" && id.startsWith("guest_")).slice(0, maxParticipants) : []),
        muteAllActive: Boolean(saved.muteAllActive), lastParticipantSnapshot: new Map(), endedAt: 0
      };
      const inviteRecords = Array.isArray(saved.inviteRecords) ? saved.inviteRecords : [];
      for (const invite of inviteRecords) {
        if (!isValidInviteCode(invite?.code) || String(invite.sessionId || "") !== session.sessionId || Number(invite.expiresAt) <= Date.now()) continue;
        invites.set(inviteDigest(invite.code), {
          code: invite.code, sessionId: session.sessionId, expiresAt: Number(invite.expiresAt),
          uses: Math.max(0, Number(invite.uses) || 0), maxUses: Math.max(1, Number(invite.maxUses) || maxInviteUses),
          createdAt: Number(invite.createdAt) || Date.now()
        });
      }
      // If old/incomplete saved state has no usable invite, issue a fresh guest link for the recovered room.
      const latestCode = (() => { try { return new URL(String(saved.inviteUrl || "")).searchParams.get("invite") || ""; } catch (_) { return ""; } })();
      if (isValidInviteCode(latestCode) && invites.has(inviteDigest(latestCode))) {
        session.inviteCode = latestCode;
        session.inviteUrl = `${session.publicOrigin}/?invite=${encodeURIComponent(latestCode)}`;
        session.inviteExpiresAt = Number(saved.inviteExpiresAt) || expiresAt;
      } else {
        const invite = makeInvite(session);
        session.inviteCode = invite.inviteCode;
        session.inviteUrl = invite.inviteUrl;
        session.inviteExpiresAt = invite.expiresAt;
      }
      session.expiryTimer = setTimeout(() => endSession("custom live duration ended after Bot restart", "system").catch(err => console.error("Recovered Live Studio auto-end failed:", err.message)), Math.max(1000, expiresAt - Date.now()));
      session.expiryTimer.unref?.();
      sessions.set(guildId, session);
      setLivePresenceSafely(true);
      cleanupRequested = false;
      botPinSweepSessionId = "";
      addActivity("room_recovered", `Live Studio recovered after Bot restart; ${Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000))} minutes remaining`);
      await persistSessionSnapshot(session).catch(err => console.warn("Recovered Live Studio state could not be refreshed in Firebase:", String(err?.message || err).slice(0, 160)));
      startupRecoveryComplete = true;
    })().finally(() => { startupRecoveryPromise = null; });
    return startupRecoveryPromise;
  }
  async function ensureStartupRecovery() {
    if (startupRecoveryComplete) return true;
    if (!client.isReady()) return false;
    try {
      await restorePersistedSessionOnStartup();
      return startupRecoveryComplete;
    } catch (err) {
      console.warn("Live Studio startup recovery deferred; Bot will retry automatically:", String(err?.message || err).slice(0, 180));
      return false;
    }
  }

  function hostUrl(session, token) {
    return `${session.publicOrigin}/#${new URLSearchParams({ token: token.token, serverUrl: token.serverUrl, room: session.roomName, role: "host", name: "RKBACKLES Host", sessionId: session.sessionId })}`;
  }
  async function getParticipants(session) {
    if (!session) return [];
    try { return await session.roomService.listParticipants(session.roomName); }
    catch (err) { if (/not found|does not exist/i.test(String(err?.message || ""))) return []; throw err; }
  }
  function participantSummary(p, session) {
    const tracks = Array.isArray(p.tracks) ? p.tracks : [];
    const sources = tracks.map(track => safeTrackSource(track?.source));
    const microphoneTracks = tracks.filter(track => safeTrackSource(track?.source) === TRACK_SOURCE.MICROPHONE);
    const id = String(p.identity || "");
    return {
      identity: id.slice(0, 120), name: String(p.name || id || "Guest").slice(0, 80), role: id === session.hostIdentity ? "host" : "guest",
      joinedAt: Number(p.joinedAt) || 0, trackCount: tracks.length,
      micMuted: session.mutedIdentities.has(id) || (microphoneTracks.length > 0 && microphoneTracks.every(track => track.muted)),
      micActive: microphoneTracks.some(track => !track.muted), screenSharing: sources.includes(TRACK_SOURCE.SCREEN_SHARE),
      screenShareAudio: sources.includes(TRACK_SOURCE.SCREEN_SHARE_AUDIO)
    };
  }
  async function enforceMutePolicy(session, participants) {
    for (const p of participants) {
      const identity = String(p.identity || "");
      if (!identity || identity === session.hostIdentity || !(session.muteAllActive || session.mutedIdentities.has(identity))) continue;
      for (const track of (Array.isArray(p.tracks) ? p.tracks : [])) {
        if (safeTrackSource(track?.source) === TRACK_SOURCE.MICROPHONE && !track.muted) {
          await session.roomService.mutePublishedTrack(session.roomName, identity, track.sid, true).catch(() => {});
        }
      }
    }
  }
  function getVoiceDirectory() {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { guildName: "Discord server", memberCount: 0, channels: [] };
    const channels = [];
    let memberCount = 0;
    for (const channel of guild.channels.cache.values()) {
      if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) continue;
      const members = [...(channel.members?.values?.() || [])].map(member => ({
        id: member.id, name: String(member.displayName || member.user?.username || member.id).slice(0, 80), bot: Boolean(member.user?.bot),
        muted: Boolean(member.voice?.serverMute || member.voice?.selfMute), deafened: Boolean(member.voice?.serverDeaf || member.voice?.selfDeaf)
      }));
      memberCount += members.length;
      channels.push({ id: channel.id, name: String(channel.name || "Voice channel").slice(0, 100), type: channel.type === ChannelType.GuildStageVoice ? "stage" : "voice", memberCount: members.length, members });
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return { guildName: String(guild.name || "Discord server").slice(0, 120), memberCount, channels };
  }
  function sendMessagesState(overwrite) {
    if (!overwrite) return "neutral";
    if (overwrite.allow?.has?.(PermissionFlagsBits.SendMessages)) return "allow";
    if (overwrite.deny?.has?.(PermissionFlagsBits.SendMessages)) return "deny";
    return "neutral";
  }
  function sendMessagesValue(state) {
    if (state === "allow") return true;
    if (state === "deny") return false;
    return null;
  }
  async function restoreChannelLock(channel, record) {
    if (!channel?.permissionOverwrites?.edit || !record?.originalStates) return true;
    let ok = true;
    for (const [targetId, original] of Object.entries(record.originalStates)) {
      try {
        const currentState = sendMessagesState(channel.permissionOverwrites.cache?.get?.(targetId));
        if (currentState === original?.state) continue;
        await channel.permissionOverwrites.edit(targetId, { SendMessages: sendMessagesValue(original?.state) }, "Restore SendMessages permissions after RKBACKLES Live Stream Radar");
      } catch (err) {
        ok = false;
        console.warn("Live channel permission restore failed:", channel.id, targetId, String(err?.message || err).slice(0, 180));
      }
    }
    return ok;
  }
  async function syncLiveChannelLocks(guild, shouldLock) {
    const ref = db.ref(channelLocksRefPath);
    const snapshot = await ref.once("value").catch(err => { console.warn("Live channel-lock index read failed:", err.message); return null; });
    // If the saved baseline cannot be read, do not infer a new baseline from live/locked overwrites.
    if (!snapshot) return false;
    const records = snapshot.val() || {};
    let allCleaned = true;
    if (!shouldLock) {
      for (const [channelId, record] of Object.entries(records)) {
        let channel = guild?.channels?.cache?.get?.(channelId) || null;
        if (!channel && guild?.channels?.fetch) channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          await ref.child(channelId).remove().catch(() => { allCleaned = false; });
          continue;
        }
        if (!(await restoreChannelLock(channel, record))) { allCleaned = false; continue; }
        await ref.child(channelId).remove().catch(() => { allCleaned = false; });
      }
      if (allCleaned) await ref.remove().catch(() => { allCleaned = false; });
      return allCleaned;
    }
    if (!guild) return false;
    const botId = String(client.user?.id || "");
    for (const channel of guild.channels.cache.values()) {
      if (!shouldUseTextChannel(channel, ChannelType)) continue;
      let record = records[channel.id];
      if (isTicketChannel(channel, guild.channels.cache)) {
        // If this channel became a ticket after the live lock started, restore it immediately.
        if (record) {
          if (await restoreChannelLock(channel, record)) await ref.child(channel.id).remove().catch(() => { allCleaned = false; });
          else allCleaned = false;
        }
        continue;
      }
      const overwriteCache = channel.permissionOverwrites?.cache;
      if (!record) {
        const originalStates = {};
        const everyoneOverwrite = overwriteCache?.get?.(String(guild.id));
        originalStates[String(guild.id)] = { state: sendMessagesState(everyoneOverwrite), hadOverwrite: Boolean(everyoneOverwrite) };
        for (const overwrite of (overwriteCache?.values?.() || [])) {
          const state = sendMessagesState(overwrite);
          if (state === "allow" || String(overwrite.id) === botId) {
            originalStates[String(overwrite.id)] = { state, hadOverwrite: true };
          }
        }
        if (botId && !originalStates[botId]) originalStates[botId] = { state: sendMessagesState(overwriteCache?.get?.(botId)), hadOverwrite: Boolean(overwriteCache?.get?.(botId)) };
        record = { channelId: channel.id, channelName: String(channel.name || "").slice(0, 100), capturedAt: Date.now(), originalStates };
      } else {
        // Preserve any new explicit SendMessages allow added while live, before overriding it.
        record.originalStates = record.originalStates || {};
        for (const overwrite of (overwriteCache?.values?.() || [])) {
          if (String(overwrite.id) === botId) continue;
          const state = sendMessagesState(overwrite);
          if (state === "allow" && !record.originalStates[String(overwrite.id)]) record.originalStates[String(overwrite.id)] = { state, hadOverwrite: true };
        }
        if (botId && !record.originalStates[botId]) record.originalStates[botId] = { state: sendMessagesState(overwriteCache?.get?.(botId)), hadOverwrite: Boolean(overwriteCache?.get?.(botId)) };
      }
      // Persist the restore snapshot before changing Discord permissions.
      let snapshotSaved = true;
      await ref.child(channel.id).set(record).catch(err => { snapshotSaved = false; allCleaned = false; console.warn("Live channel-lock snapshot save failed:", channel.id, err.message); });
      // Never change Discord permissions unless the original state was durably saved;
      // otherwise a restart could leave the channel locked with no restore snapshot.
      if (!snapshotSaved) continue;
      const targets = new Map([[String(guild.id), false]]);
      for (const overwrite of (overwriteCache?.values?.() || [])) {
        if (String(overwrite.id) === botId || String(overwrite.id) === String(guild.id)) continue;
        if (sendMessagesState(overwrite) === "allow") targets.set(String(overwrite.id), false);
      }
      // The Bot can keep Radar/status messages working; ordinary members and role overrides are denied.
      if (botId) targets.set(botId, true);
      for (const [targetId, allowSend] of targets) {
        try {
          const current = sendMessagesState(channel.permissionOverwrites?.cache?.get?.(targetId));
          if ((allowSend && current === "allow") || (!allowSend && current === "deny")) continue;
          await channel.permissionOverwrites.edit(targetId, { SendMessages: allowSend }, "Temporarily restrict chat during RKBACKLES Live Studio; ticket channels excluded");
        } catch (err) {
          allCleaned = false;
          console.warn("Live channel lock failed:", channel.id, targetId, String(err?.message || err).slice(0, 180));
        }
      }
    }
    return allCleaned;
  }
  async function syncLiveRadarMessages(guild, text, fingerprint) {
    if (!postRadarToTextChannels || pinBusy || !guild || !activeSession()) return;
    pinBusy = true;
    try {
      const ref = db.ref(pinsRefPath);
      const saved = (await ref.once("value").catch(() => null))?.val() || {};
      for (const channel of guild.channels.cache.values()) {
        if (!shouldUseTextChannel(channel, ChannelType)) continue;
        let record = saved[channel.id];
        if (isTicketChannel(channel, guild.channels.cache)) {
          // Ticket channels are excluded from Radar posting and live locks. Clean up any
          // legacy Radar post that an earlier version may have left pinned there.
          let ticketRadar = record?.messageId ? await channel.messages.fetch(String(record.messageId)).catch(() => null) : null;
          if (ticketRadar && ticketRadar.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(ticketRadar.content || ""))) {
            const noticesCleaned = await cleanupRadarPinSystemNotices(channel, [ticketRadar.id]);
            if (ticketRadar.pinned) await ticketRadar.unpin("Remove legacy RKBACKLES Radar pin from ticket channel").catch(() => {});
            await ticketRadar.delete("Remove legacy RKBACKLES Live Radar from ticket channel").then(() => {
              if (noticesCleaned) return ref.child(channel.id).remove();
            }).catch(err => console.warn("Legacy ticket Radar cleanup failed:", channel.id, String(err?.message || err).slice(0, 160)));
          }
          continue;
        }
        let message = record?.messageId ? await channel.messages.fetch(String(record.messageId)).catch(() => null) : null;
        // Recover a previous bot-owned live radar after a process restart, avoiding duplicates.
        if (!message && !record) {
          let pinned = null;
          if (typeof channel.messages.fetchPinned === "function") pinned = await channel.messages.fetchPinned().catch(() => null);
          message = pinned?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
          if (!message) {
            const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            message = recent?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
          }
          if (message) record = { messageId: message.id, pinned: Boolean(message.pinned), fingerprint: "", createdAt: message.createdTimestamp || Date.now() };
        }
        if (message) {
          try { if (record?.fingerprint !== fingerprint) await message.edit({ content: text, allowedMentions: denyMentions }); }
          catch (err) { console.warn("Live Stream Radar edit failed:", channel.id, String(err?.message || err).slice(0, 160)); continue; }
          if (!record) record = { messageId: message.id, pinned: Boolean(message.pinned), createdAt: message.createdTimestamp || Date.now(), fingerprint: "" };
          // Legacy installations may have an old pinned Radar post; unpin it now and
          // remove its associated system notice. New Radar posts are never pinned.
          if (message.pinned) {
            await cleanupRadarPinSystemNotices(channel, [message.id]).catch(() => false);
            try { await message.unpin("RKBACKLES Live Stream Radar messages are no longer pinned"); }
            catch (err) { console.warn("Legacy Radar unpin failed:", channel.id, String(err?.message || err).slice(0, 160)); }
          }
          record.pinned = false;
        } else {
          try { message = await channel.send({ content: text, allowedMentions: denyMentions }); }
          catch (err) { console.warn("Live Stream Radar could not post in channel:", channel.id, String(err?.message || err).slice(0, 180)); continue; }
          const pinned = false;
          record = { messageId: message.id, pinned, createdAt: Date.now(), fingerprint: "" };
        }
        record = { ...record, messageId: message.id, channelName: String(channel.name || "").slice(0, 100), fingerprint, lastSyncAt: Date.now() };
        await ref.child(channel.id).set(record).catch(err => console.warn("Radar pin index update failed:", err.message));
      }
    } finally { pinBusy = false; }
  }
  async function cleanupRadarPinSystemNotices(channel, targetIds) {
    const ids = new Set((Array.isArray(targetIds) ? targetIds : [targetIds]).filter(Boolean).map(String));
    if (!channel?.messages?.fetch) return true;
    const recent = await channel.messages.fetch({ limit: 100 }).catch(err => {
      console.warn("Radar pin-notice history fetch failed:", channel.id, String(err?.message || err).slice(0, 180));
      return null;
    });
    if (!recent) return false;
    let cleaned = true;
    for (const notice of recent.values()) {
      if (!isRadarPinNotice(notice, ids, client.user?.id)) continue;
      try {
        await notice.delete("Remove Discord pin system notice for ended RKBACKLES Live Stream Radar");
      } catch (err) {
        cleaned = false;
        console.warn("Radar pin system notice delete failed:", channel.id, String(err?.message || err).slice(0, 180));
      }
    }
    return cleaned;
  }
  async function unpinBotMessagesDuringLive(channel) {
    const channelId = String(channel?.id || "");
    if (!channelId || !shouldUseTextChannel(channel, ChannelType) || typeof channel.messages?.fetchPinned !== "function") return true;
    if (botPinSweepBusyChannels.has(channelId)) return true;
    botPinSweepBusyChannels.add(channelId);
    try {
      const pinned = await channel.messages.fetchPinned().catch(err => {
        console.warn("Bot pin sweep could not fetch channel pins:", channelId, String(err?.message || err).slice(0, 180));
        return null;
      });
      if (!pinned) return false;
      let allCleaned = true;
      for (const message of pinned.values()) {
        // During Live, don't allow any bot-authored message to stay pinned,
        // including old pins and messages from other bots. Ticket channels are
        // still scanned for pins; they are only exempt from the chat lock.
        if (!message?.pinned || !message.author?.bot) continue;
        let unpinned = false;
        try {
          await message.unpin("Bot-authored messages are not kept pinned during RKBACKLES Live Studio");
          unpinned = true;
        } catch (err) {
          allCleaned = false;
          console.warn("Bot message unpin during Live failed:", channelId, message.id, String(err?.message || err).slice(0, 180));
        }
        if (unpinned && !(await cleanupRadarPinSystemNotices(channel, [message.id]))) allCleaned = false;
      }
      return allCleaned;
    } finally {
      botPinSweepBusyChannels.delete(channelId);
    }
  }
  async function enforceNoBotPinsDuringLive(guild) {
    if (!guild) return false;
    let allCleaned = true;
    for (const channel of guild.channels.cache.values()) {
      if (!shouldUseTextChannel(channel, ChannelType)) continue;
      if (!(await unpinBotMessagesDuringLive(channel))) allCleaned = false;
    }
    return allCleaned;
  }

  async function cleanupLiveRadarMessages(guild) {
    // Never drop a cleanup request just because a concurrent pin/edit pass is running.
    if (!guild) return false;
    if (pinBusy) return false;
    pinBusy = true;
    let allCleaned = true;
    try {
      const ref = db.ref(pinsRefPath);
      const saved = (await ref.once("value").catch(err => { console.warn("Radar cleanup index read failed:", err.message); allCleaned = false; return null; }))?.val() || {};
      const channels = new Map(guild.channels.cache);
      // Include indexed channels even when they are not currently cached.
      for (const channelId of Object.keys(saved)) {
        if (!channels.has(channelId)) {
          const fetched = await guild.channels.fetch(channelId).catch(() => null);
          if (fetched) channels.set(channelId, fetched);
        }
      }
      for (const channel of channels.values()) {
        if (!shouldUseTextChannel(channel, ChannelType)) continue;
        const record = saved[channel.id];
        let message = record?.messageId ? await channel.messages.fetch(String(record.messageId)).catch(() => null) : null;
        // If the stored ID is stale, still find bot-owned Radar posts so they don't remain pinned.
        if (!message) {
          const pinned = typeof channel.messages.fetchPinned === "function" ? await channel.messages.fetchPinned().catch(() => null) : null;
          message = pinned?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
        }
        if (!message && typeof channel.messages.fetch === "function") {
          const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          message = recent?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
        }
        if (!message) {
          // The Radar post may already be gone while Discord's separate pin system notice remains.
          const noticesCleaned = await cleanupRadarPinSystemNotices(channel, [record?.messageId]);
          if (!noticesCleaned) allCleaned = false;
          if (record && noticesCleaned) await ref.child(channel.id).remove().catch(() => { allCleaned = false; });
          continue;
        }
        // Discord creates a second CHANNEL_PINNED_MESSAGE system notification on pin.
        // Remove only notices that reference this exact Bot-owned Radar message.
        const noticesCleaned = await cleanupRadarPinSystemNotices(channel, [record?.messageId, message.id]);
        if (!noticesCleaned) allCleaned = false;
        if (message.pinned) {
          try { await message.unpin("Live Studio ended; remove live Radar pin"); }
          catch (err) { allCleaned = false; console.warn("Radar unpin failed:", channel.id, String(err?.message || err).slice(0, 180)); }
        }
        try {
          await message.delete("Live Studio ended; remove live Radar message");
          // Keep the index if notice cleanup failed, so the next cleanup pass can retry using its message ID.
          if (noticesCleaned) await ref.child(channel.id).remove().catch(err => { allCleaned = false; console.warn("Radar index cleanup failed:", channel.id, err.message); });
        } catch (err) {
          allCleaned = false;
          console.warn("Live Stream Radar cleanup failed:", channel.id, String(err?.message || err).slice(0, 180));
        }
      }
      // Only clear the index if every accessible Radar message was handled successfully.
      if (allCleaned) await ref.remove().catch(err => { allCleaned = false; console.warn("Radar index reset failed:", err.message); });
    } finally { pinBusy = false; }
    return allCleaned;
  }
  async function publishRadar(forcePin = false) {
    if (radarBusy) return;
    if (!(await ensureStartupRecovery())) return;
    if (radarBusy) return;
    radarBusy = true;
    try {
      let session = activeSession();
      const guild = client.guilds.cache.get(guildId);
      const voice = getVoiceDirectory();
      if (!session) {
        const expired = sessions.get(guildId);
        if (expired && !expired.endedAt && expired.expiresAt <= Date.now()) await endSession("configured duration elapsed", "system", false);
        session = activeSession();
      }
      let participantInfos = [];
      if (session) {
        participantInfos = await getParticipants(session).catch(err => { console.warn("LiveKit participant poll failed:", String(err?.message || err).slice(0, 180)); return []; });
        await enforceMutePolicy(session, participantInfos).catch(err => console.warn("LiveKit mute policy error:", err.message));
        const current = new Map(participantInfos.map(p => [String(p.identity), { p, state: participantSummary(p, session) }]));
        const previous = session.lastParticipantSnapshot || new Map();
        for (const [id, value] of current) {
          if (!previous.has(id)) addActivity("live_join", `${value.state.name} joined Live Studio`);
          else {
            const before = previous.get(id).state, after = value.state;
            if (before.screenSharing !== after.screenSharing) addActivity(after.screenSharing ? "screen_share_start" : "screen_share_stop", `${after.name} ${after.screenSharing ? "started" : "stopped"} screen sharing`);
            if (before.micMuted !== after.micMuted) addActivity(after.micMuted ? "mic_muted" : "mic_unmuted", `${after.name} microphone ${after.micMuted ? "muted" : "unmuted"}`);
          }
        }
        for (const [id, value] of previous) if (!current.has(id)) addActivity("live_leave", `${value.state.name} left Live Studio`);
        session.lastParticipantSnapshot = current;
      }
      const safeParticipants = session ? participantInfos.map(p => participantSummary(p, session)) : [];
      const screenShareCount = safeParticipants.filter(p => p.screenSharing).length;
      const latest = activity[0] || { id: "idle", type: "status", summary: "Waiting for live session", at: Date.now() };
      const pinSnapshot = await db.ref(pinsRefPath).once("value").catch(() => null);
      const pinRecords = Object.values(pinSnapshot?.val() || {});
      const data = {
        version: "1.5.56", guildId, guildName: voice.guildName, active: Boolean(session), updatedAt: Date.now(),
        durationMinutes: session?.durationMinutes || 0, startedAt: session?.startedAt || 0, endsAt: session?.expiresAt || 0,
        voiceChannelCount: voice.channels.length, discordVoiceMemberCount: voice.memberCount,
        screenShareCount, participantCount: safeParticipants.length,
        session: session ? { sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: session.inviteUrl, inviteExpiresAt: session.inviteExpiresAt, participantCount: safeParticipants.length, screenShareCount, muteAllActive: session.muteAllActive } : null,
        discord: { voiceMemberCount: voice.memberCount, channels: voice.channels }, liveParticipants: safeParticipants, activity: activity.slice(0, 25),
        radar: { postsToTextChannels: postRadarToTextChannels, pinsEnabled: false, pinnedMessageCount: pinRecords.filter(record => record?.pinned === true).length }
      };
      await db.ref(radarRefPath).set(data).catch(err => console.error("Live Stream Radar Firebase update failed:", err.message));
      if (cleanupRequested && !session && guild) { if (await cleanupLiveRadarMessages(guild)) cleanupRequested = false; }
      if (session) {
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ session: session.sessionId, participantState: safeParticipants.map(p => [p.identity, p.micMuted, p.micActive, p.screenSharing, p.trackCount]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), channels: voice.channels.map(c => [c.id, c.name, c.memberCount, c.members.map(m => [m.id, m.muted, m.deafened])]), latest: latest.id, inviteUrl: session.inviteUrl, expiresAt: session.expiresAt })).digest("hex");
        if (forcePin || fingerprint !== lastRadarFingerprint) {
          lastRadarFingerprint = fingerprint;
          const text = buildRadarMessage({ guildName: voice.guildName, active: true, inviteUrl: session.inviteUrl, durationMinutes: session.durationMinutes, endsAt: session.expiresAt, participantCount: safeParticipants.length, screenShareCount, voiceMemberCount: voice.memberCount, updatedAt: latest.at, latestActivity: latest.summary });
          await syncLiveRadarMessages(guild, text, fingerprint);
        }
        // One full scan per Live session removes older pinned messages from any bot.
        if (guild && botPinSweepSessionId !== session.sessionId) {
          botPinSweepSessionId = session.sessionId;
          await enforceNoBotPinsDuringLive(guild);
        }
      } else {
        botPinSweepSessionId = "";
        if (forcePin) {
        lastRadarFingerprint = "";
        cleanupRequested = true;
        if (guild) { if (await cleanupLiveRadarMessages(guild)) cleanupRequested = false; }
        }
      }
      // During Live, deny SendMessages in all eligible non-ticket text channels;
      // when Live ends (or the process restarts offline), restore each saved permission state.
      if (guild) await syncLiveChannelLocks(guild, Boolean(session));
    } catch (err) { console.error("LIVE STREAM RADAR refresh failed:", String(err?.message || err).replace(/[\r\n\0]+/g, " ").slice(0, 220)); }
    finally { radarBusy = false; }
  }
  async function endSession(reason = "ended by Admin", actorUid = "admin", shouldPublish = true) {
    const session = sessions.get(guildId);
    if (!session || session.endedAt) return { active: false };
    session.endedAt = Date.now(); if (session.expiryTimer) clearTimeout(session.expiryTimer);
    sessions.delete(guildId);
    setLivePresenceSafely(false);
    for (const [digest, invite] of invites) if (invite.sessionId === session.sessionId) invites.delete(digest);
    await removePersistedSession(session.sessionId).catch(err => console.warn("Live Studio persisted session cleanup failed:", String(err?.message || err).slice(0, 160)));
    await session.roomService.deleteRoom(session.roomName).catch(err => console.warn("LiveKit room cleanup failed:", err.message));
    addActivity("room_end", `Live Studio ended: ${String(reason).slice(0, 100)}`, { actor: String(actorUid).slice(0, 80) });
    cleanupRequested = true;
    if (shouldPublish) await publishRadar(true);
    return { active: false, sessionId: session.sessionId };
  }
  async function startSession(actorUid, options, req) {
    if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
    const old = sessions.get(guildId);
    if (old && !old.endedAt && old.expiresAt <= Date.now()) await endSession("session expired before restart", "system", false);
    if (activeSession()) throw Object.assign(new Error("Live Studio is already active"), { statusCode: 409, apiError: "live_studio_already_active" });
    const cfg = runtime();
    const requestedOrigin = String(options?.publicOrigin || req?.get("origin") || panelOriginFallback);
    const adminPanelOrigin = allowedPanelOrigin(req, requestedOrigin);
    if (!allowedOrigins.has(adminPanelOrigin)) throw Object.assign(new Error("Admin Panel origin is not allowed. Add it to ADMIN_PANEL_ORIGINS."), { statusCode: 400, apiError: "live_studio_panel_origin_not_allowed" });
    const durationMinutes = normalizeDurationMinutes(options?.durationMinutes, defaultDurationMinutes);
    const startedAt = Date.now(), expiresAt = startedAt + durationMinutes * 60_000;
    const sessionId = crypto.randomBytes(12).toString("base64url");
    const roomName = `rkbs_${guildId}_${crypto.randomBytes(8).toString("hex")}`;
    await cfg.roomService.createRoom({ name: roomName, emptyTimeout: 90, maxParticipants, metadata: JSON.stringify({ app: "RKBACKLES", sessionId, guildId }) });
    const session = {
      sessionId, guildId, roomName, roomService: cfg.roomService, ownerUid: actorUid, startedAt, expiresAt, durationMinutes, publicOrigin: liveRoomBaseOrigin, adminPanelOrigin,
      hostIdentity: `host_${crypto.createHash("sha256").update(String(actorUid)).digest("hex").slice(0, 12)}`,
      mutedIdentities: new Set(), muteAllActive: false, lastParticipantSnapshot: new Map(), endedAt: 0
    };
    try {
      sessions.set(guildId, session);
      setLivePresenceSafely(true);
      const invite = makeInvite(session);
      await persistSessionSnapshot(session);
      const hostAccess = await createAccessToken(session, session.hostIdentity, "RKBACKLES Host", "host");
      session.expiryTimer = setTimeout(() => endSession("custom live duration ended", "system").catch(err => console.error("Live Studio auto-end failed:", err.message)), Math.max(1000, expiresAt - Date.now()));
      session.expiryTimer.unref?.();
      addActivity("room_start", `Live Studio started for ${durationMinutes} minutes by admin ${actorUid}`);
      return { session, invite, hostAccess };
    } catch (err) {
      sessions.delete(guildId);
      setLivePresenceSafely(false);
      for (const [digest, invite] of invites) if (invite.sessionId === sessionId) invites.delete(digest);
      await removePersistedSession(sessionId).catch(() => {});
      await cfg.roomService.deleteRoom(roomName).catch(() => {});
      throw err;
    }
  }

  // A minimal public route health response; never include LiveKit secrets or credentials.
  app.get("/api/live-studio/route-health", (req, res) => {
    const cfg = config();
    return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", configured: cfg.configured, missingVariables: cfg.missingVariables, panelOrigin: panelOriginFallback, liveRoomBaseOrigin, liveRoomPath: "/?invite=...", publicStatusEndpoint: "/api/live-studio/public-status", ready: cfg.configured });
  });

  // Public, minimal read-only status for the Blogger live page. Do not expose participant
  // identities, room names, host credentials, tokens, or any LiveKit secret here.
  // The only public join URL is the deliberate, multi-use guest invite generated for this session.
  app.get("/api/live-studio/public-status", async (req, res) => {
    await ensureStartupRecovery();
    const session = activeSession();
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.json({
      ok: true,
      version: "1.5.56",
      active: Boolean(session),
      updatedAt: Date.now(),
      session: session ? {
        inviteUrl: session.inviteUrl,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        durationMinutes: session.durationMinutes
      } : null
    });
  });
  // Authenticated AI-assisted role permissions. Plans never mutate Discord until the
  // Firebase-authorized admin explicitly presses Apply in the Admin Panel.
  app.get("/api/admin/role-permissions/catalog", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "role-permissions-catalog", 30, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord guild is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
      const roles = [...guild.roles.cache.values()].map(role => ({ id: role.id, name: role.name, position: role.position, managed: Boolean(role.managed), administrator: role.permissions.has(PermissionFlagsBits.Administrator) })).sort((a, b) => (a.id === guild.id ? -1 : b.id === guild.id ? 1 : b.position - a.position) || a.name.localeCompare(b.name));
      const channels = [...guild.channels.cache.values()].map(channel => ({
        id: channel.id, name: channel.name || `channel-${channel.id}`, type: rolePermissionChannelType(channel),
        parentId: channel.parentId || "", parentName: channel.parent?.name || "", editable: supportedChannelPermissionNames(channel).length > 0,
        permissionNames: supportedChannelPermissionNames(channel)
      })).filter(channel => channel.editable).sort((a, b) => (String(a.type).startsWith("Category") ? 0 : 1) - (String(b.type).startsWith("Category") ? 0 : 1) || a.name.localeCompare(b.name));
      const backupSnap = await db.ref(ROLE_PERMISSION_BACKUP_PATH).limitToLast(40).once("value").catch(() => null);
      const backups = Object.entries(backupSnap?.val() || {}).map(([id, value]) => ({ id, ...(value || {}) })).filter(item => item.status === "applied" || item.status === "reverted" || item.status === "failed").sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 12).map(item => ({
        id: item.id, roleId: String(item.roleId || ""), roleName: String(item.roleName || ""), channelId: String(item.channelId || ""), channelName: String(item.channelName || ""),
        status: String(item.status || ""), createdAt: Number(item.createdAt) || 0, appliedAt: Number(item.appliedAt) || 0, revertedAt: Number(item.revertedAt) || 0,
        summary: String(item.summary || ""), canRevert: item.status === "applied"
      }));
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", aiConfigured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()), model: String(process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini"), roles, channels, backups });
    } catch (err) { return apiError(res, err, "role_permission_catalog_failed"); }
  });

  app.post("/api/admin/role-permissions/plan", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "role-permissions-plan", 8, 60_000)) return;
      const goal = String(req.body?.goal || "").replace(/[\0]/g, "").trim().slice(0, 1200);
      if (goal.length < 6) throw Object.assign(new Error("Describe what this role should or should not be able to do (at least 6 characters)"), { statusCode: 400, apiError: "role_permission_goal_too_short" });
      const { guild, role, channel, allowedPermissions } = await getRolePermissionContext(req.body?.roleId, req.body?.channelId);
      if (allowedPermissions.length === 0) throw Object.assign(new Error("No supported permissions exist for this channel type"), { statusCode: 400, apiError: "unsupported_role_permission_channel" });
      const currentStates = currentRoleOverwriteStates(channel, role.id, allowedPermissions);
      const plan = await askOpenAiForRolePermissionPlan({ role, channel, goal, allowedPermissions, currentStates });
      // Avoid unnecessary API writes when the overwrite already has the requested state.
      plan.changes = plan.changes.map(change => {
        const alreadyMatches = (change.state === "allow" && currentStates[change.permission] === "allow") || (change.state === "deny" && currentStates[change.permission] === "deny");
        return alreadyMatches ? { ...change, state: "keep", reason: "This permission already has the requested state, so it will not be changed." } : change;
      });
      const changedCount = plan.changes.filter(change => change.state !== "keep").length;
      if (changedCount === 0) plan.rationale = `${plan.rationale} No overwrite will change unless you generate a new plan with a more specific request.`.slice(0, 1000);
      pruneRolePermissionPlans();
      const planId = crypto.randomBytes(18).toString("base64url");
      const expiresAt = Date.now() + 10 * 60_000;
      pendingRolePermissionPlans.set(planId, { id: planId, actorUid: actor.uid, guildId: guild.id, roleId: role.id, channelId: channel.id, goal, plan, allowedPermissions, expiresAt });
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", planId, expiresAt, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name, type: rolePermissionChannelType(channel) }, currentStates, changedCount, plan });
    } catch (err) { return apiError(res, err, "role_permission_plan_failed"); }
  });

  app.post("/api/admin/role-permissions/apply", async (req, res) => {
    let backupRef = null;
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "role-permissions-apply", 15, 60_000)) return;
      const planId = String(req.body?.planId || "").trim();
      pruneRolePermissionPlans();
      const plan = pendingRolePermissionPlans.get(planId);
      if (!plan || plan.expiresAt <= Date.now()) throw Object.assign(new Error("Permission plan expired or was lost on Bot restart. Generate a new plan."), { statusCode: 410, apiError: "role_permission_plan_expired" });
      if (plan.actorUid !== actor.uid) throw Object.assign(new Error("Only the admin who generated this plan can apply it"), { statusCode: 403, apiError: "role_permission_plan_actor_mismatch" });
      const { guild, role, channel } = await getRolePermissionContext(plan.roleId, plan.channelId);
      await requireRolePermissionBotAccess(guild, channel, role);
      const editPayload = buildOverwriteEdit(plan.plan.changes);
      if (!Object.keys(editPayload).length) throw Object.assign(new Error("AI plan contains no permission changes. Generate a more specific plan first."), { statusCode: 400, apiError: "role_permission_no_changes" });
      const previousOverwrite = channel.permissionOverwrites.cache.get(role.id) || null;
      const before = { exists: Boolean(previousOverwrite), allow: String(previousOverwrite?.allow?.bitfield ?? "0"), deny: String(previousOverwrite?.deny?.bitfield ?? "0") };
      backupRef = db.ref(ROLE_PERMISSION_BACKUP_PATH).push();
      const backup = {
        schemaVersion: 1, guildId: guild.id, roleId: role.id, roleName: role.name, channelId: channel.id, channelName: channel.name,
        previousOverwriteExists: before.exists, previousAllow: before.allow, previousDeny: before.deny,
        status: "pending_apply", summary: plan.plan.summary, goal: plan.goal, changes: plan.plan.changes.filter(change => change.state !== "keep"),
        createdAt: Date.now(), adminUid: actor.uid, appliedAt: 0, revertedAt: 0
      };
      // Persist the exact role overwrite state before making any Discord change.
      await backupRef.set(backup);
      try {
        await channel.permissionOverwrites.edit(role.id, editPayload, { reason: `AI Role Permission Planner approved by Firebase admin ${actor.uid}` });
      } catch (discordErr) {
        await backupRef.update({ status: "failed", failureAt: Date.now(), failure: String(discordErr?.code || discordErr?.message || "Discord permission update failed").slice(0, 180) }).catch(() => {});
        throw Object.assign(new Error("Discord rejected this permission change. Check Bot Manage Roles permission, role hierarchy, and the channel type."), { statusCode: 502, apiError: "discord_role_permission_apply_failed" });
      }
      await backupRef.update({ status: "applied", appliedAt: Date.now(), appliedAllow: String(channel.permissionOverwrites.cache.get(role.id)?.allow?.bitfield ?? "0"), appliedDeny: String(channel.permissionOverwrites.cache.get(role.id)?.deny?.bitfield ?? "0") });
      pendingRolePermissionPlans.delete(planId);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "ai_role_permissions_applied", timestamp: Date.now(), summary: `Applied AI-reviewed permission changes to role ${role.name} (${role.id}) in #${channel.name} (${channel.id})`, backupId: backupRef.key, changeCount: Object.keys(editPayload).length }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", backupId: backupRef.key, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name }, applied: Object.keys(editPayload).map(permission => ({ permission, state: editPayload[permission] ? "allow" : "deny" })), appliedAt: Date.now() });
    } catch (err) { return apiError(res, err, "role_permission_apply_failed"); }
  });

  app.get("/api/admin/community-automation/server-rules", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "community-server-rules", 20, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      const rules = await readDiscordServerRules(guild, { force: req.query?.refresh === "1" });
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", rules });
    } catch (err) { return apiError(res, err, "community_server_rules_read_failed"); }
  });

  app.post("/api/admin/community-automation/plan", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      throw Object.assign(new Error("AI rule creation is disabled. The Bot only reads existing Discord server rules and never creates or saves rules."), { statusCode: 410, apiError: "ai_rule_creation_disabled" });
    } catch (err) { return apiError(res, err, "ai_rule_creation_disabled"); }
  });

  app.post("/api/admin/community-automation/apply", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      throw Object.assign(new Error("AI rule creation is disabled. Existing Discord rules are read-only."), { statusCode: 410, apiError: "ai_rule_creation_disabled" });
    } catch (err) { return apiError(res, err, "ai_rule_creation_disabled"); }
  });
  app.post("/api/admin/community-automation/suggestion-status", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "community-suggestion-status", 30, 60_000)) return;
      const suggestionId = String(req.body?.suggestionId || "").trim();
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(suggestionId)) throw Object.assign(new Error("Suggestion ID is invalid."), { statusCode: 400, apiError: "community_suggestion_id_invalid" });
      const statusLabels = { pending: "🟡 Pending review", approved: "🟢 Approved", rejected: "🔴 Rejected", completed: "✅ Completed" };
      if (!Object.prototype.hasOwnProperty.call(statusLabels, status)) throw Object.assign(new Error("Choose pending, approved, rejected or completed."), { statusCode: 400, apiError: "community_suggestion_status_invalid" });
      const suggestionRef = db.ref(`runtime/community/suggestions/${suggestionId}`);
      const snapshot = await suggestionRef.once("value");
      const suggestion = snapshot.val();
      if (!suggestion) throw Object.assign(new Error("Suggestion was not found."), { statusCode: 404, apiError: "community_suggestion_not_found" });
      const now = Date.now();
      await suggestionRef.update({ status, statusLabel: statusLabels[status], statusAt: now, statusBy: actor.uid });
      let discordUpdated = false;
      const channelId = String(suggestion.channelId || "");
      const messageId = String(suggestion.messageId || "");
      if (/^\d{15,25}$/.test(channelId) && /^\d{15,25}$/.test(messageId)) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased?.() && channel.messages?.fetch) {
            const message = await channel.messages.fetch(messageId);
            if (message?.embeds?.[0]) {
              const embed = EmbedBuilder.from(message.embeds[0]);
              const fields = Array.isArray(embed.data.fields) ? [...embed.data.fields] : [];
              const index = fields.findIndex(field => String(field.name || "").toLowerCase() === "status");
              const statusField = { name: "Status", value: statusLabels[status], inline: true };
              if (index >= 0) fields[index] = statusField; else fields.push(statusField);
              embed.setFields(fields.slice(0, 25));
              await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
              discordUpdated = true;
            }
          }
        } catch (err) { console.warn("Could not mirror suggestion status to Discord:", err.message); }
      }
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "community_suggestion_status_update", timestamp: now, summary: `Set community suggestion ${suggestionId} to ${status}.`, suggestionId, status }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", suggestionId, status, statusLabel: statusLabels[status], discordUpdated });
    } catch (err) { return apiError(res, err, "community_suggestion_status_failed"); }
  });

  app.post("/api/admin/role-permissions/revert", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "role-permissions-revert", 15, 60_000)) return;
      const backupId = String(req.body?.backupId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(backupId)) throw Object.assign(new Error("Backup ID is invalid"), { statusCode: 400, apiError: "invalid_role_permission_backup" });
      const backupRef = db.ref(`${ROLE_PERMISSION_BACKUP_PATH}/${backupId}`);
      const backupSnap = await backupRef.once("value");
      const backup = backupSnap.val();
      if (!backup || String(backup.guildId || "") !== String(guildId)) throw Object.assign(new Error("Permission backup was not found"), { statusCode: 404, apiError: "role_permission_backup_not_found" });
      if (backup.status !== "applied") throw Object.assign(new Error("This backup is not active or has already been reverted"), { statusCode: 409, apiError: "role_permission_backup_not_active" });
      const { guild, role, channel } = await getRolePermissionContext(backup.roleId, backup.channelId);
      await requireRolePermissionBotAccess(guild, channel, role);
      if (backup.previousOverwriteExists !== true) {
        if (channel.permissionOverwrites.cache.has(role.id)) await channel.permissionOverwrites.delete(role.id, `Restore previous permission state via Admin Panel by ${actor.uid}`);
      } else {
        const restorePayload = bitfieldToRestorePayload(backup.previousAllow, backup.previousDeny, PermissionFlagsBits);
        await channel.permissionOverwrites.edit(role.id, restorePayload, { reason: `Restore prior role overwrite via Admin Panel by ${actor.uid}` });
      }
      await backupRef.update({ status: "reverted", revertedAt: Date.now(), revertedBy: actor.uid });
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "ai_role_permissions_reverted", timestamp: Date.now(), summary: `Restored previous overwrite for role ${role.name} (${role.id}) in #${channel.name} (${channel.id})`, backupId }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", backupId, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name }, revertedAt: Date.now() });
    } catch (err) { return apiError(res, err, "role_permission_revert_failed"); }
  });

  app.get("/api/admin/channel-privacy/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "channel-privacy-status", 30, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      await Promise.all([guild.roles.fetch().catch(() => {}), guild.channels.fetch().catch(() => {})]);
      const members = [...guild.members.cache.values()];
      const channelPrivacy = (await db.ref(MANUAL_CHANNEL_PRIVACY_PATH).once("value").catch(() => null))?.val() || {};
      const types = ChannelType || {};
      const channels = [...guild.channels.cache.values()].filter(channel => manualPrivacyPermissionNames(channel).length > 0 && isPubliclyVisibleChannel(channel, guild)).map(channel => ({
        id: channel.id, name: channel.name || `channel-${channel.id}`, type: privacyChannelType(channel), parentName: channel.parent?.name || "",
        locked: channelPrivacy[channel.id]?.status === "locked", memberCount: [types.GuildVoice, types.GuildStageVoice].includes(channel.type) ? Number(channel.members?.size) || 0 : null
      })).sort((a, b) => a.name.localeCompare(b.name));
      const humans = members.filter(member => !member.user?.bot);
      const onlineMembers = members.filter(member => !member.user?.bot && member.presence?.status && member.presence.status !== "offline");
      const botCount = members.filter(member => member.user?.bot).length;
      return res.set("Cache-Control", "no-store").json({
        ok: true, version: "1.5.56", guildName: String(guild.name || "Discord server").slice(0, 120),
        counts: { members: Number(guild.memberCount) || members.length, humans: humans.length, bots: botCount, onlineHumans: onlineMembers.length, cachedMembers: members.length, presenceIntentEnabledInCode: true },
        memberCountsPartial: members.length < (Number(guild.memberCount) || 0), channels
      });
    } catch (err) { return apiError(res, err, "channel_privacy_status_failed"); }
  });

  app.post("/api/admin/channel-privacy/set", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "channel-privacy-set", 20, 60_000)) return;
      if (activeSession()) throw Object.assign(new Error("End Live Studio before changing channel read-only state; the active Studio session owns temporary channel locks"), { statusCode: 409, apiError: "channel_privacy_live_conflict" });
      const { guild, channel, botMember } = await getManualPrivacyContext(req.body?.channelId);
      const lock = req.body?.locked === true;
      const ref = db.ref(`${MANUAL_CHANNEL_PRIVACY_PATH}/${channel.id}`);
      const old = (await ref.once("value")).val() || null;
      if (lock && old?.status === "locked") return res.json({ ok: true, version: "1.5.56", channelId: channel.id, locked: true, alreadySet: true });
      if (!lock) {
        if (!old || old.status !== "locked" || !old.targets) return res.json({ ok: true, version: "1.5.56", channelId: channel.id, locked: false, alreadySet: true });
        await restoreManualPrivacy(channel, old, actor.uid);
        await ref.update({ status: "unlocked", unlockedAt: Date.now(), unlockedBy: actor.uid });
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "discord_channel_readonly_disabled", timestamp: Date.now(), summary: `Restored saved permissions for #${channel.name} (${channel.id})` }).catch(() => {});
        return res.json({ ok: true, version: "1.5.56", channelId: channel.id, channelName: channel.name, locked: false });
      }

      const everyoneId = guild.id;
      const { adminRoles, protectedRoleIds } = getPrivacyAdminRoleConfig(guild, botMember);
      const restrictedPermissionNames = Object.entries(privacyLockPayload(channel)).filter(([, value]) => value === false).map(([name]) => name);
      const targetIds = await getManualPrivacyTargets(guild, channel, botMember, restrictedPermissionNames, adminRoles, protectedRoleIds);
      const lockPayload = privacyLockPayload(channel), adminPayload = privacyAdminAllowPayload(channel);
      const adminTargetIds = new Set([...adminRoles.map(role => role.id), String(client.user?.id || botMember.id)]);
      const payloadForTarget = targetId => targetId !== everyoneId && adminTargetIds.has(targetId) ? adminPayload : lockPayload;
      const targets = Object.fromEntries(targetIds.map(targetId => [targetId, overwritePermissionStates(channel, targetId, Object.keys(payloadForTarget(targetId)))]));
      const snapshot = {
        guildId: guild.id, channelId: channel.id, channelName: channel.name, type: privacyChannelType(channel),
        status: "applying", targets, createdAt: Date.now(), createdBy: actor.uid
      };
      await ref.set(snapshot);
      try {
        for (const targetId of targetIds) {
          await channel.permissionOverwrites.edit(targetId, payloadForTarget(targetId), { reason: `Read-only enabled from Admin Panel by ${actor.uid}` });
        }
        await ref.update({ status: "locked", lockedAt: Date.now(), lockedBy: actor.uid, adminRoleIds: adminRoles.map(role => role.id) });
      } catch (applyError) {
        await restoreManualPrivacy(channel, snapshot, actor.uid).catch(restoreError => console.warn("Manual privacy rollback failed:", String(restoreError?.message || restoreError).slice(0, 180)));
        await ref.update({ status: "failed", failedAt: Date.now(), failure: String(applyError?.message || applyError).slice(0, 180) }).catch(() => {});
        throw applyError;
      }
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "discord_channel_readonly_enabled", timestamp: Date.now(), summary: `Enabled view-only access for #${channel.name} (${channel.id})` }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", channelId: channel.id, channelName: channel.name, locked: true, adminRolesPreserved: adminRoles.length });
    } catch (err) { return apiError(res, err, "channel_privacy_update_failed"); }
  });

  const PRIVATE_INTEGRATION_SECRET_PATH = "serverSecrets/adminIntegrations";
  const INTEGRATION_SECRET_LIMITS = {
    discordBotToken: 240, discordClientId: 40, discordClientSecret: 300, openAiApiKey: 500,
    liveKitUrl: 500, liveKitApiKey: 300, liveKitApiSecret: 500, facebookAppId: 80, facebookAppSecret: 300,
    //আলাদা AI provider key — প্রতিটির নিজের ঘর, কখনো OPENAI_API_KEY শেয়ার করে না।
    geminiApiKey: 400, groqApiKey: 400, cerebrasApiKey: 400, openrouterApiKey: 400,
    cloudflareApiToken: 400, cloudflareAccountId: 80, nvidiaApiKey: 400,
    cohereApiKey: 400, huggingfaceApiKey: 400
  };
  const INTEGRATION_ENV_NAMES = {
    discordBotToken: "TOKEN", discordClientId: "DISCORD_CLIENT_ID", discordClientSecret: "DISCORD_CLIENT_SECRET",
    openAiApiKey: "OPENAI_API_KEY", liveKitUrl: "LIVEKIT_URL", liveKitApiKey: "LIVEKIT_API_KEY",
    liveKitApiSecret: "LIVEKIT_API_SECRET", facebookAppId: "FACEBOOK_APP_ID", facebookAppSecret: "FACEBOOK_APP_SECRET",
    geminiApiKey: "GEMINI_API_KEY", groqApiKey: "GROQ_API_KEY", cerebrasApiKey: "CEREBRAS_API_KEY",
    openrouterApiKey: "OPENROUTER_API_KEY", cloudflareApiToken: "CLOUDFLARE_API_TOKEN", cloudflareAccountId: "CLOUDFLARE_ACCOUNT_ID",
    nvidiaApiKey: "NVIDIA_API_KEY", cohereApiKey: "COHERE_API_KEY", huggingfaceApiKey: "HF_TOKEN"
  };
  // প্যানেলে দেখানো হয় provider → secret key mapping, যাতে প্রতিটি AI-এর আলাদা সেকশন থাকে।
  const AI_SECRET_SECTIONS = [
    { providerId: "gemini", label: "Google Gemini", fields: [{ key: "geminiApiKey", label: "Gemini API key", placeholder: "AIza..." }] },
    { providerId: "groq", label: "Groq", fields: [{ key: "groqApiKey", label: "Groq API key", placeholder: "gsk_..." }] },
    { providerId: "cerebras", label: "Cerebras", fields: [{ key: "cerebrasApiKey", label: "Cerebras API key", placeholder: "csk-..." }] },
    { providerId: "openrouter", label: "OpenRouter", fields: [{ key: "openrouterApiKey", label: "OpenRouter API key", placeholder: "sk-or-v1-..." }] },
    { providerId: "cloudflare", label: "Cloudflare Workers AI", fields: [{ key: "cloudflareAccountId", label: "Cloudflare account id", placeholder: "023e105f4ecef8ad9ca31a8372d0c353" }, { key: "cloudflareApiToken", label: "Cloudflare API token", placeholder: "Workers AI permission token" }] },
    { providerId: "nvidia", label: "NVIDIA NIM", fields: [{ key: "nvidiaApiKey", label: "NVIDIA API key", placeholder: "nvapi-..." }] },
    { providerId: "cohere", label: "Cohere", fields: [{ key: "cohereApiKey", label: "Cohere trial key", placeholder: "trial key" }] },
    { providerId: "huggingface", label: "Hugging Face", fields: [{ key: "huggingfaceApiKey", label: "Hugging Face token", placeholder: "hf_..." }] }
  ];
  app.get("/api/admin/integrations/secrets/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      const saved = (await db.ref(PRIVATE_INTEGRATION_SECRET_PATH).once("value").catch(() => null))?.val() || {};
      const configured = Object.fromEntries(Object.entries(INTEGRATION_ENV_NAMES).map(([key, envName]) => [key, Boolean(String(process.env[envName] || saved[key] || "").trim())]));
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", configured, restartRequired: ["discordBotToken"] });
    } catch (err) { return apiError(res, err, "integration_secrets_status_failed"); }
  });
  app.post("/api/admin/integrations/secrets/save", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "integration-secrets-save", 8, 60_000)) return;
      const values = req.body?.secrets && typeof req.body.secrets === "object" ? req.body.secrets : {};
      const clearKeys = Array.isArray(req.body?.clearKeys) ? req.body.clearKeys.map(String) : [];
      const patch = {};
      for (const [key, maxLength] of Object.entries(INTEGRATION_SECRET_LIMITS)) {
        if (clearKeys.includes(key)) { patch[key] = null; continue; }
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
        const value = String(values[key] || "").trim();
        if (!value) continue;
        if (value.length > maxLength) throw Object.assign(new Error(`${key} is too long`), { statusCode: 400, apiError: "invalid_integration_secret" });
        if (key === "liveKitUrl") {
          let url; try { url = new URL(value); } catch (_) { throw Object.assign(new Error("LiveKit URL is invalid"), { statusCode: 400, apiError: "invalid_integration_secret" }); }
          if (!/^(https?|wss?):$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw Object.assign(new Error("LiveKit URL must be a public HTTPS/WSS service URL without credentials or query text"), { statusCode: 400, apiError: "invalid_integration_secret" });
        }
        patch[key] = value;
      }
      if (!Object.keys(patch).length) return res.json({ ok: true, version: "1.5.56", changed: false, restartRequired: [] });
      const ref = db.ref(PRIVATE_INTEGRATION_SECRET_PATH);
      await ref.update(patch);
      for (const [key, value] of Object.entries(patch)) {
        const envName = INTEGRATION_ENV_NAMES[key];
        if (!envName || key === "discordBotToken") continue;
        if (value === null) delete process.env[envName]; else process.env[envName] = value;
      }
      if (Object.keys(patch).some(key => ["liveKitUrl", "liveKitApiKey", "liveKitApiSecret"].includes(key)) && !activeSession()) liveKitRuntime = null;
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "integration_secrets_updated", timestamp: Date.now(), summary: `Updated integration settings (${Object.keys(patch).length} key fields; values hidden)` }).catch(() => {});
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", changed: true, updatedKeys: Object.keys(patch), restartRequired: Object.keys(patch).includes("discordBotToken") ? ["discordBotToken"] : [] });
    } catch (err) { return apiError(res, err, "integration_secrets_save_failed"); }
  });

  // ================= AI Management routes =================
  // এই routes গুলো existing admin auth (verifyAdminApiRequest) ব্যবহার করে, তাই login আলাদা কিছু নয়।
  app.get("/api/admin/ai/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      const chat = aiChatRuntime();
      const router = aiRouterRuntime();
      const snapshot = router ? router.snapshot() : { ok: false, providers: [], totals: { requests: 0, successes: 0, failures: 0, switches: 0 }, history: [], errors: [] };
      const memoryStats = chat?.memory?.stats ? await chat.memory.stats().catch(() => ({ users: 0 })) : { users: 0 };
      return res.set("Cache-Control", "no-store").json({
        ok: true,
        version: "1.5.62",
        botOnline: Boolean(client?.user),
        autoReply: { enabled: Boolean(chat?.enabled), channels: chat ? [...chat.channels] : [], stats: chat?.stats || {}, noticeChannelId: chat?.noticeChannelId || "", pendingQueues: chat?.userQueues?.size || 0 },
        memory: memoryStats,
        freeTierOnly: true,
        ...snapshot
      });
    } catch (err) { return apiError(res, err, "ai_status_failed"); }
  });

  app.post("/api/admin/ai/provider", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-provider-update", 20, 60_000)) return;
      const router = requireAiRouter();
      const providerId = String(req.body?.providerId || "");
      if (!router.providers[providerId]) throw Object.assign(new Error("Unknown AI provider"), { statusCode: 400, apiError: "invalid_ai_provider" });
      const changes = [];
      if (typeof req.body?.enabled === "boolean") { router.setEnabled(providerId, req.body.enabled); changes.push(req.body.enabled ? "enabled" : "disabled"); }
      if (req.body?.priority !== undefined) { router.setPriority(providerId, req.body.priority); changes.push("priority"); }
      if (req.body?.model !== undefined) { router.setModel(providerId, req.body.model); changes.push("model"); }
      if (req.body?.clearCooldown === true) { router.clearCooldown(providerId); changes.push("cooldown_cleared"); }
      await router.flush();
      await writeAiAudit(actor, "ai_provider_updated", `AI provider ${providerId}: ${changes.join(", ") || "no change"}`);
      return res.json({ ok: true, version: "1.5.62", changed: changes, ...router.snapshot() });
    } catch (err) { return apiError(res, err, "ai_provider_update_failed"); }
  });

  app.post("/api/admin/ai/channels", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-channels-update", 20, 60_000)) return;
      const chat = aiChatRuntime();
      if (!chat) throw Object.assign(new Error("AI chat module এখনো চালু হয়নি"), { statusCode: 503, apiError: "ai_chat_unavailable" });
      const rawChannels = Array.isArray(req.body?.channels) ? req.body.channels : null;
      const channels = rawChannels ? rawChannels.map(id => String(id).replace(/[^\d]/g, "")).filter(id => /^\d{15,25}$/.test(id)).slice(0, 25) : undefined;
      const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
      const noticeChannelId = req.body?.noticeChannelId !== undefined ? String(req.body.noticeChannelId).replace(/[^\d]/g, "") : undefined;
      const saved = await chat.saveConfig({ channels, enabled, noticeChannelId });
      if (!saved) throw Object.assign(new Error("AI chat config সংরক্ষণ করা যায়নি"), { statusCode: 500, apiError: "ai_channels_save_failed" });
      await writeAiAudit(actor, "ai_channels_updated", `Auto-reply channels: ${[...chat.channels].join(", ") || "none"}; enabled=${chat.enabled}`);
      return res.json({ ok: true, version: "1.5.62", enabled: chat.enabled, channels: [...chat.channels], noticeChannelId: chat.noticeChannelId });
    } catch (err) { return apiError(res, err, "ai_channels_update_failed"); }
  });

  app.post("/api/admin/ai/test", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-provider-test", 6, 60_000)) return;
      const router = requireAiRouter();
      const providerId = String(req.body?.providerId || "");
      const spec = require("./ai-providers").getProviderSpec(providerId);
      if (!spec) throw Object.assign(new Error("Unknown AI provider"), { statusCode: 400, apiError: "invalid_ai_provider" });
      const state = router.providers[providerId];
      const apiKey = String(process.env[spec.env] || "").trim();
      if (!apiKey) throw Object.assign(new Error(`${spec.label} এর API key এখনো সেভ করা হয়নি`), { statusCode: 400, apiError: "ai_provider_not_configured" });
      const accountId = spec.accountEnv ? String(process.env[spec.accountEnv] || "").trim() : "";
      if (spec.accountEnv && !accountId) throw Object.assign(new Error("Cloudflare account id প্রয়োজন"), { statusCode: 400, apiError: "ai_provider_not_configured" });
      const startedAt = Date.now();
      try {
        const result = await require("./ai-providers").callProvider({ providerId, apiKey, accountId, model: state.model, system: "শুধু একটি ছোট বাংলা বাক্যে উত্তর দাও।", history: [], userText: "তুমি ঠিক আছো?", timeoutMs: 20_000 });
        router.recordSuccess(providerId, result?.usage);
        router.pushHistory({ providerId, reason: "admin_test_ok" });
        await router.flush();
        await writeAiAudit(actor, "ai_provider_tested", `AI provider ${providerId} test succeeded`);
        return res.json({ ok: true, version: "1.5.62", providerId, latencyMs: Date.now() - startedAt, model: result.model, sample: String(result.text || "").slice(0, 300) });
      } catch (err) {
        router.recordFailure(providerId, err);
        await router.flush();
        await writeAiAudit(actor, "ai_provider_tested", `AI provider ${providerId} test failed: ${String(err?.message || err).slice(0, 160)}`);
        return res.status(502).json({ ok: false, version: "1.5.62", error: "ai_provider_test_failed", message: String(err?.message || "provider test failed").slice(0, 260), kind: err?.kind || "unknown" });
      }
    } catch (err) { return apiError(res, err, "ai_provider_test_failed"); }
  });

  app.get("/api/admin/ai/memory", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      const chat = aiChatRuntime();
      if (!chat?.db) throw Object.assign(new Error("Database সংযোগ নেই"), { statusCode: 503, apiError: "ai_memory_unavailable" });
      const userId = String(req.query?.userId || "").replace(/[^\w-]/g, "");
      if (userId) {
        const record = await chat.memory.load(userId);
        return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.62", userId, record: { name: record.name, facts: record.facts, history: record.history.slice(-20), updatedAt: record.updatedAt }, config: chat.memory.config });
      }
      const snap = await chat.db.ref("ai_memory/users").limitToLast(50).once("value");
      const users = Object.entries(snap.val() || {}).map(([id, value]) => ({ userId: id, name: String(value?.name || "").slice(0, 60), facts: Array.isArray(value?.facts) ? value.facts.length : 0, turns: Array.isArray(value?.history) ? Math.ceil(value.history.length / 2) : 0, updatedAt: Number(value?.updatedAt) || 0 })).sort((a, b) => b.updatedAt - a.updatedAt);
      const stats = await chat.memory.stats();
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.62", users, stats, config: chat.memory.config });
    } catch (err) { return apiError(res, err, "ai_memory_read_failed"); }
  });

  app.post("/api/admin/ai/memory", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-memory-update", 20, 60_000)) return;
      const chat = aiChatRuntime();
      if (!chat?.db) throw Object.assign(new Error("Database সংযোগ নেই"), { statusCode: 503, apiError: "ai_memory_unavailable" });
      const action = String(req.body?.action || "");
      const userId = String(req.body?.userId || "").replace(/[^\w-]/g, "");
      if (action === "forget") {
        if (!userId) throw Object.assign(new Error("userId প্রয়োজন"), { statusCode: 400, apiError: "invalid_ai_memory_request" });
        await chat.memory.forget(userId);
        await writeAiAudit(actor, "ai_memory_forgotten", `AI memory cleared for user ${userId}`);
        return res.json({ ok: true, version: "1.5.62", userId, forgotten: true });
      }
      if (action === "addFact") {
        const fact = String(req.body?.fact || "").trim().slice(0, 220);
        if (!userId || !fact) throw Object.assign(new Error("userId ও fact প্রয়োজন"), { statusCode: 400, apiError: "invalid_ai_memory_request" });
        await chat.memory.addFact(userId, fact);
        await writeAiAudit(actor, "ai_memory_fact_added", `AI memory fact added for user ${userId}`);
        return res.json({ ok: true, version: "1.5.62", userId, added: true });
      }
      if (action === "config") {
        const patch = {};
        if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
        if (req.body?.maxTurns !== undefined) patch.maxTurns = Math.max(2, Math.min(20, Math.round(Number(req.body.maxTurns) || 8)));
        if (req.body?.maxFacts !== undefined) patch.maxFacts = Math.max(0, Math.min(30, Math.round(Number(req.body.maxFacts) || 8)));
        if (req.body?.retentionDays !== undefined) patch.retentionDays = Math.max(1, Math.min(365, Math.round(Number(req.body.retentionDays) || 30)));
        if (!Object.keys(patch).length) throw Object.assign(new Error("কোনো config দেওয়া হয়নি"), { statusCode: 400, apiError: "invalid_ai_memory_request" });
        await chat.db.ref("ai_memory/config").update({ ...patch, updatedAt: Date.now() });
        await chat.memory.loadConfig();
        await writeAiAudit(actor, "ai_memory_config_updated", `AI memory config: ${Object.keys(patch).join(", ")}`);
        return res.json({ ok: true, version: "1.5.62", config: chat.memory.config });
      }
      if (action === "prune") {
        const result = await chat.memory.prune();
        await writeAiAudit(actor, "ai_memory_pruned", `AI memory pruned: ${result.removed} users`);
        return res.json({ ok: true, version: "1.5.62", removed: result.removed });
      }
      throw Object.assign(new Error("অজানা action"), { statusCode: 400, apiError: "invalid_ai_memory_request" });
    } catch (err) { return apiError(res, err, "ai_memory_update_failed"); }
  });

  // প্রতিটি AI-এর key আলাদা সেকশনে — শুধু configured হ্যাঁ/না দেখা যায়, key কখনো ফেরত যায় না।
  app.get("/api/admin/ai/keys", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      const saved = (await db.ref(PRIVATE_INTEGRATION_SECRET_PATH).once("value").catch(() => null))?.val() || {};
      const sections = AI_SECRET_SECTIONS.map(section => ({
        providerId: section.providerId,
        label: section.label,
        fields: section.fields.map(field => ({
          key: field.key,
          label: field.label,
          placeholder: field.placeholder,
          maxLength: INTEGRATION_SECRET_LIMITS[field.key] || 400,
          env: INTEGRATION_ENV_NAMES[field.key] || "",
          configured: Boolean(String(process.env[INTEGRATION_ENV_NAMES[field.key]] || saved[field.key] || "").trim()),
          source: String(process.env[INTEGRATION_ENV_NAMES[field.key]] || "").trim() ? "environment" : String(saved[field.key] || "").trim() ? "admin_panel" : ""
        }))
      }));
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.62", sections });
    } catch (err) { return apiError(res, err, "ai_keys_read_failed"); }
  });

  app.post("/api/admin/ai/keys", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-keys-save", 12, 60_000)) return;
      const allowedKeys = new Set(AI_SECRET_SECTIONS.flatMap(section => section.fields.map(field => field.key)));
      const values = req.body?.secrets && typeof req.body.secrets === "object" ? req.body.secrets : {};
      const clearKeys = Array.isArray(req.body?.clearKeys) ? req.body.clearKeys.map(String) : [];
      const patch = {};
      for (const key of clearKeys) {
        if (!allowedKeys.has(key)) continue;
        patch[key] = null;
      }
      for (const [key, raw] of Object.entries(values)) {
        if (!allowedKeys.has(key)) continue;
        const value = String(raw || "").trim();
        if (!value) continue;
        if (value.length > (INTEGRATION_SECRET_LIMITS[key] || 400)) throw Object.assign(new Error(`${key} অনেক বড়`), { statusCode: 400, apiError: "invalid_ai_key" });
        if (/[\s]/.test(value)) throw Object.assign(new Error(`${key} এ ফাঁকা জায়গা থাকতে পারবে না`), { statusCode: 400, apiError: "invalid_ai_key" });
        if (key === "cloudflareAccountId" && !/^[a-f0-9]{32}$/i.test(value)) throw Object.assign(new Error("Cloudflare account id 32 অক্ষরের hex হতে হবে"), { statusCode: 400, apiError: "invalid_ai_key" });
        patch[key] = value;
      }
      if (!Object.keys(patch).length) return res.json({ ok: true, version: "1.5.62", changed: false });
      await db.ref(PRIVATE_INTEGRATION_SECRET_PATH).update(patch);
      for (const [key, value] of Object.entries(patch)) {
        const envName = INTEGRATION_ENV_NAMES[key];
        if (!envName) continue;
        if (value === null) delete process.env[envName]; else process.env[envName] = value;
      }
      aiRouterRuntime()?.refreshAll?.();
      await writeAiAudit(actor, "ai_keys_updated", `AI provider keys updated (${Object.keys(patch).length} fields; values hidden)`);
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.62", changed: true, updatedKeys: Object.keys(patch) });
    } catch (err) { return apiError(res, err, "ai_keys_save_failed"); }
  });

  function roleAutomationPolicy(raw = {}) {
    const cfg = raw.roleAutomation && typeof raw.roleAutomation === "object" ? raw.roleAutomation : raw;
    const idList = value => (Array.isArray(value) ? value : []).map(String).filter(id => /^\d{15,25}$/.test(id));
    const joinRoleIds = [...new Set(idList(cfg.joinRoleIds))].slice(0, 20);
    const levelRewards = (Array.isArray(cfg.levelRewards) ? cfg.levelRewards : []).map(item => ({ minLevel: Math.max(1, Math.min(1000, Math.floor(Number(item?.minLevel) || 1))), roleId: String(item?.roleId || "") })).filter(item => /^\d{15,25}$/.test(item.roleId)).slice(0, 50);
    const legacyJoinRoleIds = idList(raw.communityAutomation?.onboarding?.autoRoleIds);
    const defaultLevelRoleId = !levelRewards.length ? String(raw.discord?.roles?.level || "") : "";
    const allowedRoleIds = [...new Set([...idList(cfg.allowedRoleIds), ...joinRoleIds, ...legacyJoinRoleIds, ...levelRewards.map(item => item.roleId), ...idList([defaultLevelRoleId])])].slice(0, 50);
    return { enabled: cfg.enabled !== false, mode: cfg.mode === "manual" ? "manual" : "automatic", joinRoleIds, levelRewards, allowedRoleIds, removePreviousLevelRole: cfg.removePreviousLevelRole !== false, aiInsightsEnabled: cfg.aiInsightsEnabled !== false };
  }

  function isProtectedAutomatedRole(role) {
    return !role || role.id === role.guild?.id || role.managed || [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageChannels].some(flag => role.permissions.has(flag));
  }

  async function createAiOperationsInsight({ force = false, source = "scheduled" } = {}) {
    const config = roleAutomationPolicy((await db.ref("adminConfig/bot").once("value").catch(() => null))?.val() || {});
    if (!config.aiInsightsEnabled) return null;
    const latestRef = db.ref(`${AI_OPERATIONS_PATH}/latestInsight`), previous = (await latestRef.once("value").catch(() => null))?.val() || null;
    if (!force && previous?.dataScope === "aggregate_metrics_existing_discord_rules_and_ai_role_classification" && Number(previous?.createdAt) > Date.now() - 24 * 60 * 60_000) return previous;
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return null;
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) return null;
    const serverRules = await readDiscordServerRules(guild);
    const businessRoleDetection = await classifyBusinessRoles(guild, serverRules);
    const businessRoleTypes = new Map(businessRoleDetection.roles.map(role => [role.id, role.businessType]));
    const allMembers = [...guild.members.cache.values()].filter(member => member.guild?.id === guild.id);
    const activeMembers = allMembers.filter(member => member.presence?.status && member.presence.status !== "offline").length;
    const botMembers = allMembers.filter(member => member.user?.bot).length;
    const roles = [...guild.roles.cache.values()].filter(role => role.id !== guild.id).map(role => ({ id: role.id, name: String(role.name || "role").slice(0, 80), members: allMembers.reduce((count, member) => count + (member.roles.cache.has(role.id) ? 1 : 0), 0), businessType: businessRoleTypes.get(role.id) || "", managed: Boolean(role.managed), protected: isProtectedAutomatedRole(role) })).sort((a, b) => b.members - a.members).slice(0, 40);
    const analytics = (await db.ref("runtime/community/analytics").once("value").catch(() => null))?.val() || {};
    const sevenDays = Object.entries(analytics).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 7).reduce((totals, [, day]) => {
      for (const key of ["messages", "joins", "leaves", "faqReplies", "faqAiReplies", "suggestions", "automodHits", "ticketsArchived", "eventsSent", "keywordReplies", "raidAlerts"]) totals[key] += Math.max(0, Number(day?.[key]) || 0);
      return totals;
    }, { messages: 0, joins: 0, leaves: 0, faqReplies: 0, faqAiReplies: 0, suggestions: 0, automodHits: 0, ticketsArchived: 0, eventsSent: 0, keywordReplies: 0, raidAlerts: 0 });
    const [roleEventSnap, staffEventSnap] = await Promise.all([db.ref(`${MEMBER_ROLE_AUTOMATION_PATH}/events`).limitToLast(500).once("value").catch(() => null), db.ref(STAFF_PERFORMANCE_PATH).orderByChild("occurredAt").startAt(Date.now() - 7 * 24 * 60 * 60_000).limitToLast(2000).once("value").catch(() => null)]);
    const roleEvents = Object.values(roleEventSnap?.val() || {});
    const roleActivity = roleEvents.reduce((totals, event) => { const key = event?.action === "remove" ? "removed" : "assigned"; totals[key]++; if (event?.mode === "manual") totals.manual++; else totals.automatic++; return totals; }, { assigned: 0, removed: 0, automatic: 0, manual: 0 });
    const recentStaffEvents = Object.values(staffEventSnap?.val() || {}).filter(event => Number(event?.occurredAt) >= Date.now() - 7 * 24 * 60 * 60_000);
    const ticketActivity = { claims: recentStaffEvents.filter(event => event?.eventType === "ticket_claim").length, resolutions: recentStaffEvents.filter(event => event?.eventType === "ticket_resolve").length, activeStaff: new Set(recentStaffEvents.map(event => String(event?.discordId || "")).filter(Boolean)).size, sampleCapped: recentStaffEvents.length >= 2000 };
    const schema = { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, recommendations: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, reason: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, suggestedAction: { type: "string" } }, required: ["title", "reason", "priority", "suggestedAction"] } } }, required: ["summary", "recommendations"] };
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(25_000), body: JSON.stringify({
        model: String(process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini").trim().slice(0, 80),
        instructions: "You are a cautious Discord community operations analyst. Treat the supplied existing Discord rules-channel text as the only server policy source. Never create, edit, propose, save, or claim to add a rule. Never apply roles, permissions, payments, punishments, or configuration changes. Return practical recommendations in Bengali or English that follow the supplied rules; if a situation is not covered, say it needs Admin/staff review instead of inventing policy. Use the supplied automatic Seller/Reseller role classification as authoritative; do not infer role types from sentiment or member messages. Focus on role coverage, member onboarding, activity patterns, staff ticket activity and automation health. Do not recommend granting Administrator, Manage Roles, Manage Guild, or Manage Channels. If the rules source is unavailable, role classification is uncertain, member cache is partial, or ticket activity sample is capped, say the analysis is incomplete.",
        input: JSON.stringify({ existingDiscordRules: serverRules.available ? serverRules.content : "Unavailable: " + serverRules.reason, rulesChannelName: serverRules.channelName, businessRoleDetection: { source: businessRoleDetection.source, reason: businessRoleDetection.reason, classifiedRoles: businessRoleDetection.roles }, guildMemberCount: Number(guild.memberCount) || 0, cachedMemberCount: allMembers.length, memberCacheComplete: allMembers.length >= (Number(guild.memberCount) || 0), cachedHumans: allMembers.length - botMembers, cachedBots: botMembers, cachedOnlineMembers: activeMembers, totalRoleCount: guild.roles.cache.size, configuredRoleMode: config.mode, automationEnabled: config.enabled, roleUsage: roles, lastSevenDayActivity: sevenDays, lastSevenDayTicketActivity: ticketActivity, recentRoleChanges: roleActivity }),
        text: { format: { type: "json_schema", name: "discord_operations_insight", strict: true, schema } }, max_output_tokens: 900
      }) });
    } catch (err) { throw Object.assign(new Error("AI operations analysis could not reach the provider"), { statusCode: 502, apiError: "ai_operations_unavailable" }); }
    const payload = await response.json().catch(() => null);
    const outputText = Array.isArray(payload?.output) ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("\n") : "";
    if (!response.ok || !outputText) throw Object.assign(new Error("AI operations analysis failed; check the API key, model and quota"), { statusCode: 502, apiError: "ai_operations_provider_error" });
    let insight;
    try { insight = JSON.parse(outputText); } catch (_) { throw Object.assign(new Error("AI returned an unreadable operations report"), { statusCode: 502, apiError: "ai_operations_invalid_response" }); }
    const saved = { summary: String(insight.summary || "").slice(0, 1200), recommendations: (Array.isArray(insight.recommendations) ? insight.recommendations : []).slice(0, 6).map(item => ({ title: String(item.title || "").slice(0, 160), reason: String(item.reason || "").slice(0, 600), priority: ["low", "medium", "high"].includes(item.priority) ? item.priority : "low", suggestedAction: String(item.suggestedAction || "").slice(0, 600) })), createdAt: Date.now(), source, model: String(process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini").slice(0, 80), dataScope: "aggregate_metrics_existing_discord_rules_and_ai_role_classification", rulesChannelId: serverRules.channelId, rulesAvailable: serverRules.available, businessRoleDetectionSource: businessRoleDetection.source };
    await latestRef.set(saved);
    await db.ref(`${AI_OPERATIONS_PATH}/lastRunAt`).set(saved.createdAt).catch(() => {});
    return saved;
  }

  app.get("/api/admin/ai-operations/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-operations-status", 30, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      const [cfgSnap, insightSnap, eventSnap, analyticsSnap, staffEventSnap] = await Promise.all([db.ref("adminConfig/bot").once("value"), db.ref(`${AI_OPERATIONS_PATH}/latestInsight`).once("value"), db.ref(`${MEMBER_ROLE_AUTOMATION_PATH}/events`).limitToLast(100).once("value"), db.ref("runtime/community/analytics").once("value"), db.ref(STAFF_PERFORMANCE_PATH).orderByChild("occurredAt").startAt(Date.now() - 7 * 24 * 60 * 60_000).limitToLast(2000).once("value")]);
      const config = roleAutomationPolicy(cfgSnap.val() || {}), members = [...guild.members.cache.values()].filter(member => member.guild?.id === guild.id), total = Math.max(0, Number(guild.memberCount) || 0);
      const rulesSource = await readDiscordServerRules(guild);
      const businessRoleDetection = await classifyBusinessRoles(guild, rulesSource);
      const businessRoleTypes = new Map(businessRoleDetection.roles.map(role => [role.id, role.businessType]));
      const botMember = guild.members.me, botCanManageRoles = Boolean(botMember?.permissions.has(PermissionFlagsBits.ManageRoles)), botHighestRolePosition = Number(botMember?.roles.highest.position) || 0;
      const roles = [...guild.roles.cache.values()].map(role => ({ id: role.id, name: String(role.name || "role").slice(0, 100), position: role.position, businessType: businessRoleTypes.get(role.id) || "", managed: Boolean(role.managed), protected: isProtectedAutomatedRole(role), manualAssignable: role.id !== guild.id && !role.managed && botCanManageRoles && role.position < botHighestRolePosition, memberCount: members.reduce((count, member) => count + (member.roles.cache.has(role.id) ? 1 : 0), 0) })).sort((a, b) => b.position - a.position);
      const businessRoleGroups = Object.fromEntries(["seller", "reseller"].map(type => { const groupRoles = roles.filter(role => role.businessType === type), groupIds = new Set(groupRoles.map(role => role.id)); return [type, { roles: groupRoles.map(role => ({ id: role.id, name: role.name, memberCount: role.memberCount })), cachedMembers: members.filter(member => [...member.roles.cache.keys()].some(roleId => groupIds.has(roleId))).length }]; }));
      const bots = members.filter(member => member.user?.bot).length;
      const analytics = Object.entries(analyticsSnap.val() || {}).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 7).reduce((sum, [, day]) => sum + Math.max(0, Number(day?.messages) || 0), 0);
      const recentStaffEvents = Object.values(staffEventSnap.val() || {}).filter(event => Number(event?.occurredAt) >= Date.now() - 7 * 24 * 60 * 60_000);
      const ticketActivity = { claims: recentStaffEvents.filter(event => event?.eventType === "ticket_claim").length, resolutions: recentStaffEvents.filter(event => event?.eventType === "ticket_resolve").length, activeStaff: new Set(recentStaffEvents.map(event => String(event?.discordId || "")).filter(Boolean)).size };
      const staffRows = new Map();
      for (const event of recentStaffEvents) {
        const discordId = String(event?.discordId || ""); if (!/^\d{15,25}$/.test(discordId)) continue;
        const row = staffRows.get(discordId) || { discordId, claims: 0, resolutions: 0, resellerOrders: 0 };
        if (event.eventType === "ticket_claim") row.claims++;
        if (event.eventType === "ticket_resolve") row.resolutions++;
        if (event.eventType === "reseller_commission") row.resellerOrders++;
        staffRows.set(discordId, row);
      }
      const staffActivity = [...staffRows.values()].sort((a, b) => (b.claims + b.resolutions + b.resellerOrders) - (a.claims + a.resolutions + a.resellerOrders)).slice(0, 100);
      const events = Object.entries(eventSnap.val() || {}).map(([id, event]) => ({ id, memberId: String(event.memberId || ""), roleId: String(event.roleId || ""), roleName: String(event.roleName || ""), action: String(event.action || ""), source: String(event.source || ""), createdAt: Number(event.createdAt) || 0 })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", aiConfigured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()), config, guild: { id: guild.id, name: String(guild.name || "Discord server"), totalMembers: total, cachedMembers: members.length, cacheComplete: members.length >= total, cachedHumans: members.length - bots, cachedBots: bots, cachedOnline: members.filter(member => member.presence?.status && member.presence.status !== "offline").length, totalRoles: guild.roles.cache.size, cachedMessagesLast7Days: analytics }, rulesSource: { configured: rulesSource.configured, available: rulesSource.available, channelId: rulesSource.channelId, channelName: rulesSource.channelName, messageCount: rulesSource.messageCount, syncedAt: rulesSource.syncedAt, reason: rulesSource.reason }, businessRoleDetection: { available: businessRoleDetection.available, source: businessRoleDetection.source, reason: businessRoleDetection.reason, syncedAt: businessRoleDetection.syncedAt, rulesAvailable: businessRoleDetection.rulesAvailable, classifiedCount: businessRoleDetection.classifiedCount }, businessRoleGroups, ticketActivity, staffActivity, roleActivityWindowCapped: recentStaffEvents.length >= 2000, roles, recentRoleEvents: events, latestInsight: insightSnap.val() || null });
    } catch (err) { return apiError(res, err, "ai_operations_status_failed"); }
  });

  app.post("/api/admin/ai-operations/insights", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "ai-operations-insights", 4, 60 * 60_000)) return;
      const config = roleAutomationPolicy((await db.ref("adminConfig/bot").once("value")).val() || {});
      if (!config.aiInsightsEnabled) throw Object.assign(new Error("AI operations insights are turned off in the Admin Panel"), { statusCode: 409, apiError: "ai_operations_disabled" });
      const insight = await createAiOperationsInsight({ force: true, source: `admin:${String(actor.uid).slice(0, 80)}` });
      if (!insight) throw Object.assign(new Error("AI is not configured. Set the private OpenAI API key in Setup & Status."), { statusCode: 503, apiError: "ai_operations_not_configured" });
      return res.json({ ok: true, version: "1.5.56", insight });
    } catch (err) { return apiError(res, err, "ai_operations_insight_failed"); }
  });

  app.get("/api/admin/members/search", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "admin-member-search", 60, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      const query = String(req.query?.query || "").trim().slice(0, 64), limit = Math.max(1, Math.min(50, Number.parseInt(req.query?.limit, 10) || 40));
      const cachedMembers = [...guild.members.cache.values()].filter(member => member.guild?.id === guild.id && member.user);
      const found = new Map();
      let searchMode = "cache";
      if (query.length >= 2) {
        try {
          const matches = await guild.members.search({ query, limit, cache: true });
          for (const member of matches.values()) found.set(member.id, member);
          searchMode = "discord";
        } catch (_) { searchMode = "cache_fallback"; }
      }
      const needle = query.toLocaleLowerCase();
      const cachedMatches = query ? cachedMembers.filter(member => String(member.displayName || "").toLocaleLowerCase().includes(needle) || String(member.user.username || "").toLocaleLowerCase().includes(needle) || String(member.user.globalName || "").toLocaleLowerCase().includes(needle)) : cachedMembers;
      for (const member of cachedMatches) if (found.size < limit) found.set(member.id, member);
      const ranked = [...found.values()].sort((a, b) => {
        const aName = String(a.displayName || a.user.username || "").toLocaleLowerCase(), bName = String(b.displayName || b.user.username || "").toLocaleLowerCase();
        const aPrefix = query && (aName.startsWith(needle) || String(a.user.username || "").toLocaleLowerCase().startsWith(needle)) ? 0 : 1;
        const bPrefix = query && (bName.startsWith(needle) || String(b.user.username || "").toLocaleLowerCase().startsWith(needle)) ? 0 : 1;
        return aPrefix - bPrefix || aName.localeCompare(bName);
      }).slice(0, limit);
      const members = ranked.map(member => ({
        id: member.id,
        username: String(member.user.username || "").slice(0, 80),
        globalName: String(member.user.globalName || "").slice(0, 80),
        displayName: String(member.displayName || member.user.globalName || member.user.username || "Member").slice(0, 100),
        avatarUrl: member.displayAvatarURL({ extension: "png", size: 64 }),
        bot: Boolean(member.user.bot),
        isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
        roleIds: [...member.roles.cache.keys()],
        roles: [...member.roles.cache.values()].filter(role => role.id !== guild.id).map(role => ({ id: role.id, name: String(role.name || "role").slice(0, 80) })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)
      }));
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", query, searchMode, cachedMembers: cachedMembers.length, members });
    } catch (err) { return apiError(res, err, "admin_member_search_failed"); }
  });
  app.post("/api/admin/member-roles/change", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "member-role-change", 30, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      const memberId = validateDiscordSnowflake(req.body?.memberId, "Member"), roleId = validateDiscordSnowflake(req.body?.roleId, "Role"), action = String(req.body?.action || "");
      if (!["add", "remove"].includes(action)) throw Object.assign(new Error("Choose add or remove"), { statusCode: 400, apiError: "invalid_member_role_action" });
      const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (!member || member.guild.id !== guild.id || !role || role.guild.id !== guild.id) throw Object.assign(new Error("Member or role was not found in this server"), { statusCode: 404, apiError: "member_or_role_not_found" });
      if (role.id === guild.id || role.managed || !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= botMember.roles.highest.position || member.roles.highest.position >= botMember.roles.highest.position) throw Object.assign(new Error("Discord prevents this Bot from assigning the selected role or managing this member. Check Manage Roles and place the Bot's highest role above both the selected role and member."), { statusCode: 403, apiError: "member_role_change_protected" });
      const hasRole = member.roles.cache.has(roleId);
      if ((action === "add" && !hasRole)) await member.roles.add(role, `Manual role update via Admin Panel by ${actor.uid}`);
      else if (action === "remove" && hasRole) await member.roles.remove(role, `Manual role update via Admin Panel by ${actor.uid}`);
      else return res.json({ ok: true, version: "1.5.56", changed: false, memberId, roleId, action });
      const event = { memberId, roleId, roleName: role.name.slice(0, 100), action, source: "Admin Panel manual action", mode: "manual", adminUid: actor.uid, createdAt: Date.now() };
      await Promise.all([db.ref(`${MEMBER_ROLE_AUTOMATION_PATH}/events`).push(event), db.ref("auditLog").push({ adminUid: actor.uid, actionType: `manual_role_${action}`, timestamp: event.createdAt, summary: `${action === "add" ? "Assigned" : "Removed"} Discord role ${role.name} (${role.id}) for member ${memberId}` })]);
      return res.json({ ok: true, version: "1.5.56", changed: true, memberId, roleId, roleName: role.name, action });
    } catch (err) { return apiError(res, err, "member_role_change_failed"); }
  });

  let lastAiOperationsRunAt = 0;
  const runScheduledAiInsight = async () => {
    const config = roleAutomationPolicy((await db.ref("adminConfig/bot").once("value").catch(() => null))?.val() || {});
    if (!config.aiInsightsEnabled || !String(process.env.OPENAI_API_KEY || "").trim() || Date.now() - lastAiOperationsRunAt < 23 * 60 * 60_000) return;
    try { await createAiOperationsInsight({ force: false, source: "scheduled_daily" }); lastAiOperationsRunAt = Date.now(); }
    catch (err) { console.warn("Scheduled AI operations insight failed:", String(err?.message || err).slice(0, 180)); }
  };
  client.on("ready", () => runScheduledAiInsight().catch(() => {}));
  const aiOperationsTimer = setInterval(() => runScheduledAiInsight().catch(() => {}), 60 * 60_000);
  aiOperationsTimer.unref?.();

  app.get("/api/admin/member-counter/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "member-counter-status", 30, 60_000)) return;
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      await guild.channels.fetch().catch(() => {});
      const active = (await db.ref(MEMBER_COUNTER_PATH).once("value").catch(() => null))?.val() || {};
      const channels = [...guild.channels.cache.values()].filter(isVoiceCounterChannel).map(channel => ({
        id: channel.id, name: String(channel.name || "Voice channel").slice(0, 100), type: "voice",
        memberCount: Number(channel.members?.size) || 0, selected: active.enabled === true && String(active.channelId) === channel.id
      })).sort((a, b) => a.name.localeCompare(b.name));
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", enabled: active.enabled === true, status: String(active.status || "disabled"), channelId: String(active.channelId || ""), template: String(active.template || "members-{count}"), displayedName: String(active.displayedName || ""), memberCount: Number(active.memberCount) || Number(guild.memberCount) || 0, guildMemberCount: Number(guild.memberCount) || 0, channels });
    } catch (err) { return apiError(res, err, "member_counter_status_failed"); }
  });

  app.post("/api/admin/member-counter/set", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "member-counter-set", 12, 60_000)) return;
      const ref = db.ref(MEMBER_COUNTER_PATH);
      const previous = (await ref.once("value")).val() || null;
      if (req.body?.enabled !== true) {
        if (previous?.enabled && previous.channelId) await restoreCounterBeforeSwitch(previous, actor.uid);
        await ref.update({ enabled: false, status: "disabled", disabledAt: Date.now(), disabledBy: actor.uid }).catch(() => {});
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "member_counter_disabled", timestamp: Date.now(), summary: `Disabled the server member counter${previous?.channelName ? ` and restored #${previous.channelName}` : ""}` }).catch(() => {});
        return res.json({ ok: true, version: "1.5.56", enabled: false, restored: Boolean(previous?.channelId) });
      }
      const template = String(req.body?.template || "members-{count}").trim().slice(0, 90) || "members-{count}";
      if (!/\{(?:members|count)\}/i.test(template)) throw Object.assign(new Error("Channel name template must include {count} or {members}"), { statusCode: 400, apiError: "member_counter_template_missing_count" });
      const { guild, channel, botMember } = await getMemberCounterChannel(req.body?.channelId);
      if (previous?.enabled && String(previous.channelId) !== channel.id) await restoreCounterBeforeSwitch(previous, actor.uid);
      const sameChannel = previous?.enabled === true && String(previous.channelId) === channel.id && previous.originalConnectStates;
      const targetIds = sameChannel ? Object.keys(previous.originalConnectStates) : await memberCounterConnectTargets(guild, channel, botMember);
      const originalConnectStates = sameChannel ? previous.originalConnectStates : Object.fromEntries(targetIds.map(targetId => [targetId, overwriteState(channel.permissionOverwrites.cache.get(targetId), "Connect", PermissionFlagsBits)]));
      const snapshot = {
        enabled: true, status: "applying", channelId: channel.id, channelName: String(channel.name || "").slice(0, 100),
        originalName: sameChannel ? String(previous.originalName || channel.name || "").slice(0, 100) : String(channel.name || "").slice(0, 100),
        originalConnectStates, template, selectedAt: sameChannel ? Number(previous.selectedAt) || Date.now() : Date.now(), selectedBy: actor.uid
      };
      await ref.set(snapshot);
      try {
        for (const targetId of targetIds) await channel.permissionOverwrites.edit(targetId, { Connect: false }, { reason: `Lock voice channel for Admin Panel member counter by ${actor.uid}` });
        const count = Math.max(0, Number(guild.memberCount) || guild.members.cache.size || 0), displayedName = counterChannelName(template, count);
        if (channel.name !== displayedName) await channel.setName(displayedName, `Enable server member counter by ${actor.uid}`);
        await ref.update({ status: "active", memberCount: count, displayedName, updatedAt: Date.now() });
      } catch (applyError) {
        await restoreMemberCounterChannel(snapshot, actor.uid).catch(restoreError => console.warn("Member counter rollback failed:", String(restoreError?.message || restoreError).slice(0, 180)));
        await ref.update({ enabled: false, status: "failed", failedAt: Date.now(), failure: String(applyError?.message || applyError).slice(0, 180) }).catch(() => {});
        throw applyError;
      }
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "member_counter_enabled", timestamp: Date.now(), summary: `Enabled locked voice member counter in #${channel.name} (${channel.id})` }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", enabled: true, channelId: channel.id, channelName: channel.name, memberCount: Number(guild.memberCount) || 0 });
    } catch (err) { return apiError(res, err, "member_counter_update_failed"); }
  });

  async function compensationConfig() {
    const cfg = getCompensationConfig() || {};
    const bounded = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
    const guild = client.guilds.cache.get(String(guildId));
    const serverRules = guild ? await readDiscordServerRules(guild) : null;
    const businessRoleDetection = guild ? await classifyBusinessRoles(guild, serverRules) : { available: false, source: "unavailable", reason: "discord_guild_unavailable", roles: [] };
    return {
      enabled: cfg.enabled === true,
      ticketClaimRateBdt: bounded(cfg.ticketClaimRateBdt, 0, 0, 1_000_000),
      ticketResolveRateBdt: bounded(cfg.ticketResolveRateBdt, 0, 0, 1_000_000),
      resellerCommissionEnabled: cfg.resellerCommissionEnabled === true,
      aiResellerCommissionEnabled: cfg.aiResellerCommissionEnabled === true,
      resellerBasePercent: bounded(cfg.resellerBasePercent, 0, 0, 100),
      resellerMinPercent: bounded(cfg.resellerMinPercent, 0, 0, 100),
      resellerMaxPercent: bounded(cfg.resellerMaxPercent, 20, 0, 100),
      resellerRoleIds: businessRoleDetection.roles.filter(role => role.businessType === "reseller").map(role => role.id),
      businessRoleDetection
    };
  }

  function monthFromTimestamp(value) {
    const date = new Date(Number(value) || 0);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).formatToParts(date);
    return `${parts.find(part => part.type === "year")?.value || ""}-${parts.find(part => part.type === "month")?.value || ""}`;
  }

  async function calculateResellerPercent(config, amountBdt, recentOrderCount) {
    const min = Math.min(config.resellerMinPercent, config.resellerMaxPercent);
    const max = Math.max(config.resellerMinPercent, config.resellerMaxPercent);
    const base = Math.max(min, Math.min(max, config.resellerBasePercent));
    if (!config.aiResellerCommissionEnabled || !String(process.env.OPENAI_API_KEY || "").trim()) return { percent: base, source: "fixed_fallback" };
    const schema = { type: "object", additionalProperties: false, properties: { commissionPercent: { type: "number" } }, required: ["commissionPercent"] };
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", headers: { "Authorization": `Bearer ${String(process.env.OPENAI_API_KEY).trim()}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: String(process.env.OPENAI_RESELLER_COMMISSION_MODEL || "gpt-5.4-mini").trim().slice(0, 80),
          instructions: "Recommend a reseller commission percentage using only the supplied aggregate figures. The result must be within the supplied minimum and maximum. Never return currency or identifying data.",
          input: JSON.stringify({ orderAmountBdt: amountBdt, resellerCompletedOrdersLast30Days: recentOrderCount, basePercent: base, minimumPercent: min, maximumPercent: max }),
          text: { format: { type: "json_schema", name: "bounded_reseller_commission", strict: true, schema } }, max_output_tokens: 120
        })
      });
    } catch (_) { return { percent: base, source: "fixed_fallback" }; }
    const payload = await response.json().catch(() => null);
    const outputText = Array.isArray(payload?.output) ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("\n") : "";
    try {
      if (!response.ok || !outputText) throw new Error("AI commission unavailable");
      const parsed = JSON.parse(outputText), proposed = Number(parsed.commissionPercent);
      if (!Number.isFinite(proposed)) throw new Error("AI commission invalid");
      return { percent: Math.round(Math.max(min, Math.min(max, proposed)) * 100) / 100, source: "ai_bounded" };
    } catch (_) { return { percent: base, source: "fixed_fallback" }; }
  }

  async function assignResellerCommission(checkoutKeyValue, resellerDiscordIdValue, actorUid = "automatic") {
    const checkoutKey = String(checkoutKeyValue || "").trim();
    const resellerDiscordId = String(resellerDiscordIdValue || "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(checkoutKey) || !/^\d{15,25}$/.test(resellerDiscordId)) throw Object.assign(new Error("Order key or reseller Discord ID is invalid"), { statusCode: 400, apiError: "invalid_reseller_assignment" });
    const config = await compensationConfig();
    if (!config.resellerCommissionEnabled) throw Object.assign(new Error("Enable reseller commission in Staff & Salary settings first"), { statusCode: 409, apiError: "reseller_commission_disabled" });
    if (!config.resellerRoleIds.length) throw Object.assign(new Error("AI could not confidently identify a Reseller role from the existing Discord rules and roles"), { statusCode: 409, apiError: "reseller_role_missing" });
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
    const member = guild.members.cache.get(resellerDiscordId) || await guild.members.fetch(resellerDiscordId).catch(() => null);
    if (!member || !config.resellerRoleIds.some(id => member.roles.cache.has(id))) throw Object.assign(new Error("That Discord member does not have an AI-detected Reseller role"), { statusCode: 403, apiError: "reseller_role_required" });
    const orderRef = db.ref(`pending_payments/${checkoutKey}`);
    const assignment = await orderRef.transaction(current => {
      if (!current || (current.resellerDiscordId && String(current.resellerDiscordId) !== resellerDiscordId)) return;
      return { ...current, resellerDiscordId, resellerAssignedAt: Number(current.resellerAssignedAt) || Date.now(), resellerAssignedBy: String(current.resellerAssignedBy || actorUid).slice(0, 80) };
    }, undefined, false);
    const order = assignment.snapshot.val();
    if (!order) throw Object.assign(new Error("Order was not found or another reseller was assigned first"), { statusCode: 409, apiError: "reseller_already_assigned" });
    if (String(order.resellerDiscordId || "") !== resellerDiscordId) throw Object.assign(new Error("A different reseller is already assigned to this order"), { statusCode: 409, apiError: "reseller_already_assigned" });
    if (String(order.status || "") !== "completed") {
      await db.ref("auditLog").push({ adminUid: String(actorUid), actionType: "reseller_attributed_order", timestamp: Date.now(), summary: `Assigned reseller ${resellerDiscordId} to order ${checkoutKey}; commission will be calculated when the order completes` }).catch(() => {});
      return { eventType: "reseller_attribution_pending", discordId: resellerDiscordId, checkoutKey, status: String(order.status || "pending") };
    }
    const amountBdt = Math.max(0, Number(order.totalPaid) || Number(order.targetPrice) || Number(order.basePrice) || 0);
    if (!amountBdt) throw Object.assign(new Error("Completed order has no payable amount"), { statusCode: 409, apiError: "reseller_order_amount_missing" });
    const eventId = `reseller_${checkoutKey}`;
    const eventRef = db.ref(`${STAFF_PERFORMANCE_PATH}/${eventId}`);
    const previousEvent = (await eventRef.once("value")).val();
    if (previousEvent) {
      if (String(previousEvent.discordId) !== resellerDiscordId) throw Object.assign(new Error("This order already has a commission for a different reseller"), { statusCode: 409, apiError: "reseller_commission_exists" });
      return previousEvent;
    }
    const events = (await db.ref(STAFF_PERFORMANCE_PATH).once("value")).val() || {};
    const recentOrderCount = Object.values(events).filter(event => event?.eventType === "reseller_commission" && String(event.discordId) === resellerDiscordId && Number(event.occurredAt) >= Date.now() - 30 * 86_400_000).length;
    const rate = await calculateResellerPercent(config, amountBdt, recentOrderCount);
    const event = {
      eventType: "reseller_commission", discordId: resellerDiscordId, checkoutKey, amountBdt: Math.round(amountBdt * rate.percent) / 100,
      orderAmountBdt: Math.round(amountBdt * 100) / 100, commissionPercent: rate.percent, commissionSource: rate.source,
      occurredAt: Date.now(), month: monthFromTimestamp(Date.now()), status: "unpaid"
    };
    const created = await eventRef.transaction(current => current || event, undefined, false);
    const saved = created.snapshot.val() || event;
    await orderRef.update({ resellerDiscordId, resellerCommission: saved.amountBdt, resellerCommissionPercent: saved.commissionPercent, resellerCommissionSource: saved.commissionSource, resellerCommissionEventId: eventId });
    await db.ref("auditLog").push({ adminUid: String(actorUid), actionType: "reseller_commission_recorded", timestamp: Date.now(), summary: `Recorded reseller commission for order ${checkoutKey}: ${saved.commissionPercent}% (${saved.commissionSource})` }).catch(() => {});
    return saved;
  }

  app.get("/api/admin/compensation/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "compensation-status", 20, 60_000)) return;
      const month = String(req.query?.month || new Date().toISOString().slice(0, 7));
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error("Month must use YYYY-MM format"), { statusCode: 400, apiError: "invalid_compensation_month" });
      const [eventsSnap, payoutsSnap] = await Promise.all([db.ref(STAFF_PERFORMANCE_PATH).once("value"), db.ref(`${STAFF_PAYOUTS_PATH}/${month}`).once("value")]);
      const cfg = await compensationConfig(), events = Object.values(eventsSnap.val() || {}).filter(event => (String(event.month || monthFromTimestamp(event.occurredAt)) === month));
      const grouped = new Map();
      for (const event of events) {
        const discordId = String(event.discordId || ""); if (!/^\d{15,25}$/.test(discordId)) continue;
        const row = grouped.get(discordId) || { discordId, claims: 0, resolutions: 0, completedResellerOrders: 0, ticketEarningsBdt: 0, resellerCommissionBdt: 0, payoutBdt: 0 };
        if (event.eventType === "ticket_claim") { row.claims++; row.ticketEarningsBdt += Math.max(0, Number(event.amountBdt) || 0); }
        if (event.eventType === "ticket_resolve") { row.resolutions++; row.ticketEarningsBdt += Math.max(0, Number(event.amountBdt) || 0); }
        if (event.eventType === "reseller_commission") { row.completedResellerOrders++; row.resellerCommissionBdt += Math.max(0, Number(event.amountBdt) || 0); }
        row.payoutBdt = row.ticketEarningsBdt + row.resellerCommissionBdt;
        grouped.set(discordId, row);
      }
      const payouts = payoutsSnap.val() || {};
      const rows = [...grouped.values()].sort((a, b) => b.payoutBdt - a.payoutBdt).map(row => ({ ...row, payout: payouts[row.discordId] || null }));
      const { resellerRoleIds, businessRoleDetection, ...settings } = cfg;
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", month, settings, businessRoleDetection: { available: businessRoleDetection.available, source: businessRoleDetection.source, reason: businessRoleDetection.reason, syncedAt: businessRoleDetection.syncedAt, rulesAvailable: businessRoleDetection.rulesAvailable, roles: businessRoleDetection.roles.map(role => ({ name: role.name, businessType: role.businessType, evidence: role.evidence, confidence: role.confidence })) }, rows });
    } catch (err) { return apiError(res, err, "compensation_status_failed"); }
  });

  app.post("/api/admin/compensation/settle", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "compensation-settle", 20, 60_000)) return;
      const month = String(req.body?.month || ""), discordId = String(req.body?.discordId || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{15,25}$/.test(discordId)) throw Object.assign(new Error("Month or Discord ID is invalid"), { statusCode: 400, apiError: "invalid_compensation_settlement" });
      const events = Object.values((await db.ref(STAFF_PERFORMANCE_PATH).once("value")).val() || {}).filter(event => String(event.discordId) === discordId && String(event.month || monthFromTimestamp(event.occurredAt)) === month);
      const total = events.reduce((sum, event) => sum + Math.max(0, Number(event.amountBdt) || 0), 0);
      if (!(total > 0)) throw Object.assign(new Error("No payable balance is recorded for this member and month"), { statusCode: 409, apiError: "compensation_balance_empty" });
      const ref = db.ref(`${STAFF_PAYOUTS_PATH}/${month}/${discordId}`);
      const settlementId = crypto.randomUUID();
      const result = await ref.transaction(current => current || { status: "marked_paid_manually", settlementId, amountBdt: Math.round(total * 100) / 100, eventCount: events.length, paidAt: Date.now(), paidBy: actor.uid }, undefined, false);
      if (!result.committed || result.snapshot.val()?.settlementId !== settlementId) throw Object.assign(new Error("This balance was already marked settled"), { statusCode: 409, apiError: "compensation_already_settled" });
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "staff_compensation_marked_paid", timestamp: Date.now(), summary: `Marked ৳${Math.round(total * 100) / 100} settled for Discord member ${discordId} (${month})` }).catch(() => {});
      return res.json({ ok: true, version: "1.5.56", month, discordId, amountBdt: Math.round(total * 100) / 100, payout: result.snapshot.val() });
    } catch (err) { return apiError(res, err, "compensation_settlement_failed"); }
  });

  app.post("/api/admin/compensation/reseller", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "reseller-commission", 30, 60_000)) return;
      const event = await assignResellerCommission(req.body?.checkoutKey, req.body?.resellerDiscordId, actor.uid);
      return res.json({ ok: true, version: "1.5.56", event });
    } catch (err) { return apiError(res, err, "reseller_commission_failed"); }
  });

  const processCompletedResellerOrder = snapshot => {
    const order = snapshot?.val?.();
    if (!order || String(order.status || "") !== "completed" || !order.resellerDiscordId || order.resellerCommissionEventId) return;
    assignResellerCommission(snapshot.key, order.resellerDiscordId, "automatic").catch(err => {
      if (!new Set(["reseller_commission_disabled", "reseller_role_missing", "reseller_order_not_completed"]).has(err.apiError)) console.warn("Automatic reseller commission failed:", String(err?.message || err).slice(0, 180));
    });
  };
  db.ref("pending_payments").on("child_added", processCompletedResellerOrder, err => console.warn("Reseller commission listener failed:", String(err?.message || err).slice(0, 160)));
  db.ref("pending_payments").on("child_changed", processCompletedResellerOrder, err => console.warn("Reseller commission listener failed:", String(err?.message || err).slice(0, 160)));

  app.get("/api/admin/live-studio/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      const session = activeSession();
      const participants = session ? await getParticipants(session) : [];
      const voice = getVoiceDirectory();
      let hostJoinUrl = "";
      if (session) hostJoinUrl = hostUrl(session, await createAccessToken(session, session.hostIdentity, "RKBACKLES Host", "host"));
      const radar = (await db.ref(radarRefPath).once("value").catch(() => null))?.val() || null;
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.56", configured: config().configured, active: Boolean(session), session: session ? { sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: session.inviteUrl, inviteExpiresAt: session.inviteExpiresAt, participantCount: participants.length, screenShareCount: participants.filter(p => trackFlags(p.tracks).screenSharing).length, muteAllActive: session.muteAllActive } : null, participants: session ? participants.map(p => participantSummary(p, session)) : [], voiceChannels: voice.channels, discordVoiceMemberCount: voice.memberCount, hostJoinUrl, radar });
    } catch (err) { return apiError(res, err, "live_studio_status_failed"); }
  });
  app.post("/api/admin/live-studio/start", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "live-studio-start", 5, 60_000)) return;
      const { session, invite, hostAccess } = await startSession(actor.uid, req.body || {}, req);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_start", timestamp: Date.now(), summary: `Live Studio started for ${session.durationMinutes} minutes; invite ${session.inviteUrl}` }).catch(() => {});
      cleanupRequested = false;
      await publishRadar(true);
      return res.json({ ok: true, version: "1.5.56", active: true, sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: invite.inviteUrl, inviteCode: invite.inviteCode, maxUses: invite.maxUses, hostJoinUrl: hostUrl(session, hostAccess), radarPinsEnabled: false, radarPostsEnabled: postRadarToTextChannels, nonTicketChannelsLockedDuringLive: true, publicOrigin: session.publicOrigin });
    } catch (err) { return apiError(res, err, "live_studio_start_failed"); }
  });
  app.post("/api/admin/live-studio/invite", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      if (!checkCppRateLimit(req, res, "live-studio-invite", 12, 60_000)) return;
      const session = activeSession();
      if (!session) throw Object.assign(new Error("Start Live Studio first"), { statusCode: 409, apiError: "live_studio_not_active" });
      const invite = makeInvite(session);
      await persistSessionSnapshot(session).catch(err => console.warn("Live invite state persistence failed:", String(err?.message || err).slice(0, 160)));
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_invite_create", timestamp: Date.now(), summary: "Created multi-use invite for active Live Studio" }).catch(() => {});
      await publishRadar(true);
      return res.json({ ok: true, ...invite, sessionId: session.sessionId });
    } catch (err) { return apiError(res, err, "live_studio_invite_failed"); }
  });
  app.post("/api/admin/live-studio/end", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      if (!checkCppRateLimit(req, res, "live-studio-end", 10, 60_000)) return;
      const result = await endSession("ended by Firebase Admin", actor.uid);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_end", timestamp: Date.now(), summary: "Live Studio ended; invites revoked and radar messages removed" }).catch(() => {});
      return res.json({ ok: true, ...result });
    } catch (err) { return apiError(res, err, "live_studio_end_failed"); }
  });
  app.post("/api/live-studio/redeem", async (req, res) => {
    try {
      if (!checkCppRateLimit(req, res, "live-studio-redeem", 30, 60_000)) return;
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      const code = String(req.body?.inviteCode || "");
      if (!isValidInviteCode(code)) throw Object.assign(new Error("Invite link is invalid. Return to the Admin Panel for an active link."), { statusCode: 400, apiError: "live_studio_invite_invalid" });
      const digest = inviteDigest(code), invite = invites.get(digest);
      if (!invite || invite.expiresAt <= Date.now()) { invites.delete(digest); throw Object.assign(new Error("Invite link is invalid or expired. Return to the Admin Panel for a current link."), { statusCode: 410, apiError: "live_studio_invite_expired" }); }
      const session = activeSession();
      if (!session || session.sessionId !== invite.sessionId) throw Object.assign(new Error("This Live Studio has ended. Return to the Admin Panel for a new link."), { statusCode: 410, apiError: "live_studio_not_active" });
      if (invite.uses >= invite.maxUses) throw Object.assign(new Error("This invite has reached its join limit."), { statusCode: 410, apiError: "live_studio_invite_exhausted" });
      invite.uses += 1;
      await persistSessionSnapshot(session).catch(err => console.warn("Live invite-use persistence failed:", String(err?.message || err).slice(0, 160)));
      const identity = `guest_${crypto.randomBytes(12).toString("hex")}`;
      const name = cleanName(req.body?.displayName, `Guest ${crypto.randomInt(1000, 9999)}`);
      const access = await createAccessToken(session, identity, name, "guest");
      addActivity("invite_join", `${name} joined through the room invite`);
      await publishRadar(true);
      return res.json({ ok: true, sessionId: session.sessionId, roomName: session.roomName, identity, name, role: "guest", ...access });
    } catch (err) { return res.status(Number(err?.statusCode) || 500).json({ ok: false, error: String(err?.apiError || "live_studio_redeem_failed"), message: String(err?.message || "Could not join Live Studio").slice(0, 240) }); }
  });
  app.post("/api/admin/live-studio/mute", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      if (!checkCppRateLimit(req, res, "live-studio-mute", 60, 60_000)) return;
      const session = activeSession(); if (!session) throw Object.assign(new Error("No active Live Studio"), { statusCode: 409, apiError: "live_studio_not_active" });
      const identity = String(req.body?.identity || ""); if (!identity.startsWith("guest_")) throw Object.assign(new Error("Only guest participants can be muted"), { statusCode: 400, apiError: "invalid_studio_target" });
      const participants = await getParticipants(session), participant = participants.find(p => String(p.identity) === identity);
      if (!participant) throw Object.assign(new Error("Participant not found"), { statusCode: 404, apiError: "studio_participant_not_found" });
      const muted = req.body?.muted !== false;
      if (muted) session.mutedIdentities.add(identity); else session.mutedIdentities.delete(identity);
      const allowedSources = (muted || session.muteAllActive) ? [TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO] : [TRACK_SOURCE.MICROPHONE, TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO];
      await session.roomService.updateParticipant(session.roomName, identity, { permission: { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: allowedSources } });
      await enforceMutePolicy(session, [participant]);
      addActivity(muted ? "participant_muted" : "participant_unmuted", `${identity} mic ${muted ? "muted" : "unmuted"}`);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: muted ? "live_studio_mute" : "live_studio_unmute", timestamp: Date.now(), summary: `${muted ? "Muted" : "Unmuted"} Live Studio participant ${identity}` }).catch(() => {});
      await persistSessionSnapshot(session).catch(err => console.warn("Live mute state persistence failed:", String(err?.message || err).slice(0, 160)));
      await publishRadar(true); return res.json({ ok: true, identity, muted });
    } catch (err) { return apiError(res, err, "live_studio_mute_failed"); }
  });
  app.post("/api/admin/live-studio/mute-all", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      if (!checkCppRateLimit(req, res, "live-studio-mute-all", 12, 60_000)) return;
      const session = activeSession(); if (!session) throw Object.assign(new Error("No active Live Studio"), { statusCode: 409, apiError: "live_studio_not_active" });
      session.muteAllActive = req.body?.muted !== false;
      const participants = (await getParticipants(session)).filter(p => String(p.identity) !== session.hostIdentity);
      if (session.muteAllActive) for (const p of participants) session.mutedIdentities.add(String(p.identity)); else session.mutedIdentities.clear();
      const allowedSources = session.muteAllActive ? [TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO] : [TRACK_SOURCE.MICROPHONE, TRACK_SOURCE.SCREEN_SHARE, TRACK_SOURCE.SCREEN_SHARE_AUDIO];
      const results = await Promise.allSettled(participants.map(p => session.roomService.updateParticipant(session.roomName, String(p.identity), { permission: { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: allowedSources } })));
      await enforceMutePolicy(session, participants);
      addActivity(session.muteAllActive ? "mute_all" : "unmute_all", `${session.muteAllActive ? "Mute everyone enabled" : "Mute everyone disabled"} (${participants.length})`);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: session.muteAllActive ? "live_studio_mute_all" : "live_studio_unmute_all", timestamp: Date.now(), summary: `${session.muteAllActive ? "Muted" : "Unmuted"} all guests (${participants.length})` }).catch(() => {});
      await persistSessionSnapshot(session).catch(err => console.warn("Live mute-all state persistence failed:", String(err?.message || err).slice(0, 160)));
      await publishRadar(true); return res.json({ ok: results.every(r => r.status === "fulfilled"), muted: session.muteAllActive, total: participants.length, permissionUpdates: results.filter(r => r.status === "fulfilled").length });
    } catch (err) { return apiError(res, err, "live_studio_mute_all_failed"); }
  });
  app.post("/api/admin/live-studio/kick", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!(await ensureStartupRecovery())) throw Object.assign(new Error("Bot startup recovery is still running; retry in a few seconds"), { statusCode: 503, apiError: "live_studio_startup_recovery_pending" });
      if (!checkCppRateLimit(req, res, "live-studio-kick", 40, 60_000)) return;
      const session = activeSession(); if (!session) throw Object.assign(new Error("No active Live Studio"), { statusCode: 409, apiError: "live_studio_not_active" });
      const identity = String(req.body?.identity || ""); if (!identity.startsWith("guest_")) throw Object.assign(new Error("Cannot remove the room host"), { statusCode: 400, apiError: "invalid_studio_target" });
      await session.roomService.removeParticipant(session.roomName, identity);
      session.mutedIdentities.delete(identity); addActivity("participant_kicked", `${identity} removed by Admin`);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_kick", timestamp: Date.now(), summary: `Removed Live Studio guest ${identity}` }).catch(() => {});
      await persistSessionSnapshot(session).catch(err => console.warn("Live kick state persistence failed:", String(err?.message || err).slice(0, 160)));
      await publishRadar(true); return res.json({ ok: true, identity });
    } catch (err) { return apiError(res, err, "live_studio_kick_failed"); }
  });
  app.post("/api/admin/live-studio/discord-voice-action", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "live-studio-discord-voice-action", 60, 60_000)) return;
      const guild = client.guilds.cache.get(guildId); if (!guild) throw Object.assign(new Error("Configured Discord server is not available to the Bot"), { statusCode: 503, apiError: "discord_guild_unavailable" });
      const channelId = String(req.body?.channelId || ""), userId = String(req.body?.userId || ""), action = String(req.body?.action || "");
      const channel = guild.channels.cache.get(channelId); if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) throw Object.assign(new Error("Voice channel not found"), { statusCode: 404, apiError: "discord_voice_channel_not_found" });
      const member = channel.members?.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member || member.voice.channelId !== channelId) throw Object.assign(new Error("Member is not in the selected voice channel"), { statusCode: 404, apiError: "discord_voice_member_not_found" });
      if (member.id === client.user?.id) throw Object.assign(new Error("The Bot cannot moderate itself"), { statusCode: 400, apiError: "invalid_discord_voice_target" });
      if (action === "mute") await member.voice.setMute(true, "Admin Panel Live Stream Radar");
      else if (action === "unmute") await member.voice.setMute(false, "Admin Panel Live Stream Radar");
      else if (action === "deafen") await member.voice.setDeaf(true, "Admin Panel Live Stream Radar");
      else if (action === "undeafen") await member.voice.setDeaf(false, "Admin Panel Live Stream Radar");
      else if (action === "disconnect") await member.voice.disconnect("Admin Panel Live Stream Radar");
      else throw Object.assign(new Error("Unsupported voice action"), { statusCode: 400, apiError: "invalid_discord_voice_action" });
      addActivity(`discord_voice_${action}`, `${member.user.username} ${action} in #${channel.name}`);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: `discord_voice_${action}`, timestamp: Date.now(), summary: `${action} Discord voice member ${userId} in ${channelId}` }).catch(() => {});
      await publishRadar(true); return res.json({ ok: true, action, userId, channelId });
    } catch (err) { return apiError(res, err, "discord_voice_action_failed"); }
  });

  // During Live, immediately unpin bot-authored messages and remove their pin notice
  // whenever Discord announces a change to channel pins.
  client.on("channelPinsUpdate", async channel => {
    if (!activeSession() || channel?.guild?.id !== guildId) return;
    if (!shouldUseTextChannel(channel, ChannelType)) return;
    await unpinBotMessagesDuringLive(channel);
  });
  client.on("messageCreate", async message => {
    if (message?.guildId !== guildId || Number(message?.type) !== CHANNEL_PINNED_MESSAGE_TYPE || !activeSession()) return;
    const targetId = pinNoticeTargetId(message);
    if (!targetId || !message.channel?.messages?.fetch) return;
    const target = await message.channel.messages.fetch(targetId).catch(() => null);
    // Delete only the system notice for a confirmed bot-authored pinned message.
    if (!target || !target.author?.bot) return;
    try {
      if (target.pinned) await target.unpin("Bot-authored messages are not kept pinned during RKBACKLES Live Studio");
      await message.delete("Remove pin notice for bot-authored message during RKBACKLES Live Studio");
    } catch (err) {
      console.warn("Bot pin system notice cleanup failed:", message.channelId || message.channel?.id, String(err?.message || err).slice(0, 180));
    }
  });
  client.on("ready", () => {
    addActivity("bot_ready", "Discord Bot online; Live Stream Radar is ready");
    publishRadar(true).catch(() => {});
    updateMemberCounterName().catch(err => console.warn("Member counter startup sync failed:", String(err?.message || err).slice(0, 160)));
  });
  client.on("guildMemberAdd", member => { if (member.guild?.id === guildId) updateMemberCounterName().catch(() => {}); });
  client.on("guildMemberRemove", member => { if (member.guild?.id === guildId) updateMemberCounterName().catch(() => {}); });
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (newState.guild?.id !== guildId) return;
    const member = newState.member || oldState.member;
    const name = String(member?.displayName || member?.user?.username || member?.id || "Member").slice(0, 80);
    if (!oldState.channelId && newState.channelId) addActivity("voice_join", `${name} joined ${newState.channel?.name || "a voice channel"}`);
    else if (oldState.channelId && !newState.channelId) addActivity("voice_leave", `${name} left ${oldState.channel?.name || "a voice channel"}`);
    else if (oldState.channelId !== newState.channelId) addActivity("voice_move", `${name} moved to ${newState.channel?.name || "another voice channel"}`);
    else if (Boolean(oldState.serverMute || oldState.selfMute) !== Boolean(newState.serverMute || newState.selfMute)) addActivity("voice_mute", `${name} microphone ${newState.serverMute || newState.selfMute ? "muted" : "unmuted"}`);
    publishRadar(true).catch(() => {});
  });
  for (const event of ["channelCreate", "channelDelete", "channelUpdate"]) client.on(event, (oldChannel, newChannel) => {
    const channel = newChannel || oldChannel;
    if (channel?.guild?.id === guildId) publishRadar(true).catch(() => {});
    if (event === "channelDelete") db.ref(MEMBER_COUNTER_PATH).once("value").then(snap => { const state = snap.val(); if (state?.enabled && String(state.channelId) === String(channel?.id)) db.ref(MEMBER_COUNTER_PATH).update({ enabled: false, status: "missing", disabledAt: Date.now() }); }).catch(() => {});
  });
  const counterTimer = setInterval(() => updateMemberCounterName().catch(err => console.warn("Member counter sync failed:", String(err?.message || err).slice(0, 120))), 60_000);
  counterTimer.unref?.();
  const radarTimer = setInterval(() => publishRadar(false).catch(() => {}), 5000);
  radarTimer.unref?.();
  return { sessions, invites, publishRadar, endSession };
}
module.exports = { attachLiveStudioServer };
