"use strict";
const crypto = require("crypto");
const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { TRACK_SOURCE, CHANNEL_PINNED_MESSAGE_TYPE, pinNoticeTargetId, isBotPinActorNotice, isRadarPinNotice, isValidInviteCode, inviteDigest, cleanName, safeTrackSource, trackFlags, normalizeDurationMinutes, safeOrigin, shouldUseTextChannel, isTicketChannel, buildRadarMessage } = require("./live-studio-core");
const { normalizeAiPlan, buildOverwriteEdit, bitfieldToRestorePayload, overwriteState } = require("./role-permissions");
const { normalizeKeywordRules, cleanText } = require("./community-automation");

function attachLiveStudioServer({ app, client, db, guildId, verifyAdminApiRequest, checkCppRateLimit, ChannelType, allowedOrigins, setLivePresence = () => {} }) {
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
  const pendingRolePermissionPlans = new Map();
  const pendingCommunityAutomationPlans = new Map();

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
        version: "1.5.47", guildId, guildName: voice.guildName, active: Boolean(session), updatedAt: Date.now(),
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
    return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.47", configured: cfg.configured, missingVariables: cfg.missingVariables, panelOrigin: panelOriginFallback, liveRoomBaseOrigin, liveRoomPath: "/?invite=...", publicStatusEndpoint: "/api/live-studio/public-status", ready: cfg.configured });
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
      version: "1.5.47",
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
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.47", aiConfigured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()), model: String(process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini"), roles, channels, backups });
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
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.47", planId, expiresAt, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name, type: rolePermissionChannelType(channel) }, currentStates, changedCount, plan });
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
      return res.json({ ok: true, version: "1.5.47", backupId: backupRef.key, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name }, applied: Object.keys(editPayload).map(permission => ({ permission, state: editPayload[permission] ? "allow" : "deny" })), appliedAt: Date.now() });
    } catch (err) { return apiError(res, err, "role_permission_apply_failed"); }
  });

  // Natural-language automation rule builder: generate a preview first, then require
  // the same authenticated admin to explicitly approve saving the safe keyword rule.
  app.post("/api/admin/community-automation/plan", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "community-automation-plan", 6, 60_000)) return;
      const goal = cleanText(req.body?.goal || "", 900);
      if (goal.length < 8) throw Object.assign(new Error("Describe the automation in at least 8 characters."), { statusCode: 400, apiError: "community_automation_goal_too_short" });
      const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
      if (!apiKey) throw Object.assign(new Error("AI is not configured. Set OPENAI_API_KEY on the private Bot host."), { statusCode: 503, apiError: "community_automation_ai_not_configured" });
      const model = String(process.env.OPENAI_AUTOMATION_MODEL || process.env.OPENAI_ROLE_PERMISSIONS_MODEL || "gpt-5.4-mini").trim().slice(0, 80);
      const schema = {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "string" },
          rules: { type: "array", items: {
            type: "object", additionalProperties: false,
            properties: {
              name: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
              reply: { type: "string" },
              cooldownSeconds: { type: "integer" }
            }, required: ["name", "keywords", "reply", "cooldownSeconds"]
          } }
        }, required: ["summary", "rules"]
      };
      let response;
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(22_000),
          body: JSON.stringify({
            model, max_output_tokens: 1200,
            instructions: "Convert an admin's natural-language request into 1-3 simple Discord keyword-reply automation rules. Output exactly the requested JSON schema. These rules can only post a plain text reply when a message contains one of the supplied keywords. Never create roles, assign permissions, delete content, timeout users, call external URLs, execute code, use mentions or mass-ping, change channels, or claim an action was performed. The reply must be safe, concise, and based only on the user's stated instruction. Use a cooldown between 15 and 600 seconds. Keywords must be short exact phrases, not wildcard patterns.",
            input: JSON.stringify({ request: goal, allowedAction: "keyword_reply only; plain text reply; no permission or moderation changes" }),
            text: { format: { type: "json_schema", name: "rkbackles_keyword_automation_plan", strict: true, schema } }
          })
        });
      } catch (_) { throw Object.assign(new Error("AI service could not be reached. Try again shortly."), { statusCode: 502, apiError: "community_automation_ai_unavailable" }); }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error("AI rule generation failed. Check API key, model availability, and provider quota."), { statusCode: 502, apiError: "community_automation_ai_provider_error" });
      const outputText = Array.isArray(payload?.output) ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text").map(item => item.text || "").join("\n") : "";
      let parsed;
      try { parsed = JSON.parse(outputText); } catch (_) { throw Object.assign(new Error("AI returned an invalid rule plan. Try a clearer instruction."), { statusCode: 502, apiError: "community_automation_ai_invalid_response" }); }
      const rules = (Array.isArray(parsed.rules) ? parsed.rules : []).slice(0, 3).map((rule, index) => ({
        id: crypto.randomBytes(8).toString("hex"), name: cleanText(rule.name || `Rule ${index + 1}`, 100),
        type: "keyword_reply", enabled: true,
        keywords: [...new Set((Array.isArray(rule.keywords) ? rule.keywords : []).map(value => cleanText(value, 80).toLowerCase()).filter(value => value.length >= 2))].slice(0, 10),
        reply: cleanText(rule.reply || "", 1400), cooldownSeconds: Math.max(15, Math.min(600, Number(rule.cooldownSeconds) || 30))
      })).filter(rule => rule.keywords.length && rule.reply);
      if (!rules.length) throw Object.assign(new Error("AI could not generate a usable keyword rule. Make the request more specific."), { statusCode: 502, apiError: "community_automation_ai_empty_plan" });
      for (const [key, old] of pendingCommunityAutomationPlans) if (!old || old.expiresAt <= Date.now()) pendingCommunityAutomationPlans.delete(key);
      const planId = crypto.randomBytes(18).toString("base64url");
      const plan = { id: planId, actorUid: actor.uid, expiresAt: Date.now() + 10 * 60_000, summary: cleanText(parsed.summary || "Keyword reply rules are ready for review.", 240), rules };
      pendingCommunityAutomationPlans.set(planId, plan);
      while (pendingCommunityAutomationPlans.size > 100) pendingCommunityAutomationPlans.delete(pendingCommunityAutomationPlans.keys().next().value);
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.47", planId, expiresAt: plan.expiresAt, summary: plan.summary, rules });
    } catch (err) { return apiError(res, err, "community_automation_plan_failed"); }
  });

  app.post("/api/admin/community-automation/apply", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "community-automation-apply", 12, 60_000)) return;
      const planId = String(req.body?.planId || "").trim();
      const plan = pendingCommunityAutomationPlans.get(planId);
      if (!plan || plan.expiresAt <= Date.now()) throw Object.assign(new Error("Automation proposal expired or was lost on Bot restart. Generate it again."), { statusCode: 410, apiError: "community_automation_plan_expired" });
      if (plan.actorUid !== actor.uid) throw Object.assign(new Error("Only the admin who created the proposal can apply it."), { statusCode: 403, apiError: "community_automation_actor_mismatch" });
      const rulesRef = db.ref("adminConfig/bot/communityAutomation/rules");
      let savedRules = [];
      const result = await rulesRef.transaction(current => {
        const existing = normalizeKeywordRules(current);
        const additions = plan.rules.map((rule, index) => ({ ...rule, id: `${Date.now().toString(36)}_${index}_${crypto.randomBytes(3).toString("hex")}` }));
        savedRules = [...existing, ...additions].slice(-100);
        return savedRules;
      }, undefined, false);
      if (!result.committed) throw Object.assign(new Error("Could not save automation rules. Retry after refreshing the Admin Panel."), { statusCode: 503, apiError: "community_automation_save_failed" });
      pendingCommunityAutomationPlans.delete(planId);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "ai_community_automation_applied", timestamp: Date.now(), summary: `Applied ${plan.rules.length} approved keyword reply automation rule(s).`, ruleNames: plan.rules.map(rule => rule.name) }).catch(() => {});
      return res.json({ ok: true, version: "1.5.47", addedCount: plan.rules.length, rules: plan.rules.map(rule => ({ name: rule.name, keywords: rule.keywords })) });
    } catch (err) { return apiError(res, err, "community_automation_apply_failed"); }
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
      return res.json({ ok: true, version: "1.5.47", suggestionId, status, statusLabel: statusLabels[status], discordUpdated });
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
      return res.json({ ok: true, version: "1.5.47", backupId, role: { id: role.id, name: role.name }, channel: { id: channel.id, name: channel.name }, revertedAt: Date.now() });
    } catch (err) { return apiError(res, err, "role_permission_revert_failed"); }
  });

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
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.47", configured: config().configured, active: Boolean(session), session: session ? { sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: session.inviteUrl, inviteExpiresAt: session.inviteExpiresAt, participantCount: participants.length, screenShareCount: participants.filter(p => trackFlags(p.tracks).screenSharing).length, muteAllActive: session.muteAllActive } : null, participants: session ? participants.map(p => participantSummary(p, session)) : [], voiceChannels: voice.channels, discordVoiceMemberCount: voice.memberCount, hostJoinUrl, radar });
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
      return res.json({ ok: true, version: "1.5.47", active: true, sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: invite.inviteUrl, inviteCode: invite.inviteCode, maxUses: invite.maxUses, hostJoinUrl: hostUrl(session, hostAccess), radarPinsEnabled: false, radarPostsEnabled: postRadarToTextChannels, nonTicketChannelsLockedDuringLive: true, publicOrigin: session.publicOrigin });
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
  client.on("ready", () => { addActivity("bot_ready", "Discord Bot online; Live Stream Radar is ready"); publishRadar(true).catch(() => {}); });
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
  for (const event of ["channelCreate", "channelDelete", "channelUpdate"]) client.on(event, (oldChannel, newChannel) => { const channel = newChannel || oldChannel; if (channel?.guild?.id === guildId) publishRadar(true).catch(() => {}); });
  const radarTimer = setInterval(() => publishRadar(false).catch(() => {}), 5000);
  radarTimer.unref?.();
  return { sessions, invites, publishRadar, endSession };
}
module.exports = { attachLiveStudioServer };
