"use strict";
const crypto = require("crypto");
const { TRACK_SOURCE, isValidInviteCode, inviteDigest, cleanName, safeTrackSource, trackFlags, normalizeDurationMinutes, safeOrigin, shouldUseTextChannel, buildRadarMessage } = require("./live-studio-core");

function attachLiveStudioServer({ app, client, db, guildId, verifyAdminApiRequest, checkCppRateLimit, ChannelType, allowedOrigins, setLivePresence = () => {} }) {
  const sessions = new Map();
  const invites = new Map();
  const activity = [];
  const panelOriginFallback = String(process.env.LIVE_STUDIO_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://admin-9x7v1.wuaze.com").trim().replace(/\/+$/, "");
  const maxParticipants = Math.max(2, Math.min(100, Number(process.env.LIVE_STUDIO_MAX_PARTICIPANTS || 20)));
  const defaultDurationMinutes = normalizeDurationMinutes(process.env.LIVE_STUDIO_DEFAULT_DURATION_MINUTES || 60);
  const maxInviteUses = Math.max(maxParticipants, Math.min(100000, Number(process.env.LIVE_STUDIO_MAX_INVITE_USES || 10000)));
  const radarRefPath = "runtime/liveStreamRadar";
  const pinsRefPath = "runtime/liveStreamRadarPins";
  const pinAllTextChannels = String(process.env.LIVE_STREAM_RADAR_PIN_ALL_TEXT_CHANNELS ?? "true").toLowerCase() !== "false";
  const denyMentions = { parse: [] };
  let liveKitRuntime = null, radarBusy = false, pinBusy = false, lastRadarFingerprint = "", cleanupRequested = true;
  function setLivePresenceSafely(active) {
    try { setLivePresence(Boolean(active)); }
    catch (err) { console.warn("Live Studio profile activity update failed:", String(err?.message || err).slice(0, 160)); }
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
    invites.set(inviteDigest(code), { sessionId: session.sessionId, expiresAt, uses: 0, maxUses: maxInviteUses, createdAt: Date.now() });
    session.inviteCode = code;
    session.inviteUrl = `${session.publicOrigin}/live-room.html?invite=${encodeURIComponent(code)}`;
    session.inviteExpiresAt = expiresAt;
    return { inviteCode: code, inviteUrl: session.inviteUrl, expiresAt, maxUses: maxInviteUses };
  }
  function hostUrl(session, token) {
    return `${session.publicOrigin}/live-room.html#${new URLSearchParams({ token: token.token, serverUrl: token.serverUrl, room: session.roomName, role: "host", name: "RKBACKLES Host", sessionId: session.sessionId })}`;
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
  async function syncLiveRadarMessages(guild, text, fingerprint) {
    if (!pinAllTextChannels || pinBusy || !guild || !activeSession()) return;
    pinBusy = true;
    try {
      const ref = db.ref(pinsRefPath);
      const saved = (await ref.once("value").catch(() => null))?.val() || {};
      for (const channel of guild.channels.cache.values()) {
        if (!shouldUseTextChannel(channel, ChannelType)) continue;
        let record = saved[channel.id];
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
          if (!record.pinned) {
            try { await message.pin("RKBACKLES LIVE STREAM RADAR · live status"); record.pinned = true; }
            catch (err) { console.warn("Live Stream Radar pin denied:", channel.id, String(err?.message || err).slice(0, 160)); }
          }
        } else {
          try { message = await channel.send({ content: text, allowedMentions: denyMentions }); }
          catch (err) { console.warn("Live Stream Radar could not post in channel:", channel.id, String(err?.message || err).slice(0, 180)); continue; }
          let pinned = false;
          try { await message.pin("RKBACKLES LIVE STREAM RADAR · live status"); pinned = true; }
          catch (err) { console.warn("Live Stream Radar pin denied:", channel.id, String(err?.message || err).slice(0, 160)); }
          record = { messageId: message.id, pinned, createdAt: Date.now(), fingerprint: "" };
        }
        record = { ...record, messageId: message.id, channelName: String(channel.name || "").slice(0, 100), fingerprint, lastSyncAt: Date.now() };
        await ref.child(channel.id).set(record).catch(err => console.warn("Radar pin index update failed:", err.message));
      }
    } finally { pinBusy = false; }
  }
  async function cleanupLiveRadarMessages(guild) {
    if (!guild || pinBusy) return;
    pinBusy = true;
    try {
      const ref = db.ref(pinsRefPath);
      const saved = (await ref.once("value").catch(() => null))?.val() || {};
      for (const channel of guild.channels.cache.values()) {
        if (!shouldUseTextChannel(channel, ChannelType)) continue;
        let record = saved[channel.id];
        let message = record?.messageId ? await channel.messages.fetch(String(record.messageId)).catch(() => null) : null;
        if (!message && !record) {
          const pinned = typeof channel.messages.fetchPinned === "function" ? await channel.messages.fetchPinned().catch(() => null) : null;
          message = pinned?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
        }
        if (!message) continue;
        if (message.pinned) await message.unpin("Live Studio ended; clean up live status").catch(err => console.warn("Radar unpin failed:", channel.id, String(err?.message || err).slice(0, 140)));
        await message.delete().catch(err => console.warn("Live Stream Radar cleanup failed:", channel.id, String(err?.message || err).slice(0, 160)));
      }
      await ref.remove().catch(() => {});
    } finally { pinBusy = false; }
  }
  async function publishRadar(forcePin = false) {
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
        version: "1.5.39", guildId, guildName: voice.guildName, active: Boolean(session), updatedAt: Date.now(),
        durationMinutes: session?.durationMinutes || 0, startedAt: session?.startedAt || 0, endsAt: session?.expiresAt || 0,
        voiceChannelCount: voice.channels.length, discordVoiceMemberCount: voice.memberCount,
        screenShareCount, participantCount: safeParticipants.length,
        session: session ? { sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: session.inviteUrl, inviteExpiresAt: session.inviteExpiresAt, participantCount: safeParticipants.length, screenShareCount, muteAllActive: session.muteAllActive } : null,
        discord: { voiceMemberCount: voice.memberCount, channels: voice.channels }, liveParticipants: safeParticipants, activity: activity.slice(0, 25),
        radar: { pinAllTextChannels, pinnedMessageCount: pinRecords.filter(record => record?.pinned === true).length }
      };
      await db.ref(radarRefPath).set(data).catch(err => console.error("Live Stream Radar Firebase update failed:", err.message));
      if (cleanupRequested && !session && guild) { await cleanupLiveRadarMessages(guild); cleanupRequested = false; }
      if (session) {
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ session: session.sessionId, participantState: safeParticipants.map(p => [p.identity, p.micMuted, p.micActive, p.screenSharing, p.trackCount]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), channels: voice.channels.map(c => [c.id, c.name, c.memberCount, c.members.map(m => [m.id, m.muted, m.deafened])]), latest: latest.id, inviteUrl: session.inviteUrl, expiresAt: session.expiresAt })).digest("hex");
        if (forcePin || fingerprint !== lastRadarFingerprint) {
          lastRadarFingerprint = fingerprint;
          const text = buildRadarMessage({ guildName: voice.guildName, active: true, inviteUrl: session.inviteUrl, durationMinutes: session.durationMinutes, endsAt: session.expiresAt, participantCount: safeParticipants.length, screenShareCount, voiceMemberCount: voice.memberCount, updatedAt: latest.at, latestActivity: latest.summary });
          await syncLiveRadarMessages(guild, text, fingerprint);
        }
      } else if (forcePin) {
        lastRadarFingerprint = "";
        cleanupRequested = true;
        if (guild) { await cleanupLiveRadarMessages(guild); cleanupRequested = false; }
      }
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
    await session.roomService.deleteRoom(session.roomName).catch(err => console.warn("LiveKit room cleanup failed:", err.message));
    addActivity("room_end", `Live Studio ended: ${String(reason).slice(0, 100)}`, { actor: String(actorUid).slice(0, 80) });
    cleanupRequested = true;
    if (shouldPublish) await publishRadar(true);
    return { active: false, sessionId: session.sessionId };
  }
  async function startSession(actorUid, options, req) {
    const old = sessions.get(guildId);
    if (old && !old.endedAt && old.expiresAt <= Date.now()) await endSession("session expired before restart", "system", false);
    if (activeSession()) throw Object.assign(new Error("Live Studio is already active"), { statusCode: 409, apiError: "live_studio_already_active" });
    const cfg = runtime();
    const requestedOrigin = String(options?.publicOrigin || req?.get("origin") || panelOriginFallback);
    const publicOrigin = allowedPanelOrigin(req, requestedOrigin);
    if (!allowedOrigins.has(publicOrigin)) throw Object.assign(new Error("Admin Panel origin is not allowed. Add it to ADMIN_PANEL_ORIGINS."), { statusCode: 400, apiError: "live_studio_panel_origin_not_allowed" });
    const durationMinutes = normalizeDurationMinutes(options?.durationMinutes, defaultDurationMinutes);
    const startedAt = Date.now(), expiresAt = startedAt + durationMinutes * 60_000;
    const sessionId = crypto.randomBytes(12).toString("base64url");
    const roomName = `rkbs_${guildId}_${crypto.randomBytes(8).toString("hex")}`;
    await cfg.roomService.createRoom({ name: roomName, emptyTimeout: 90, maxParticipants, metadata: JSON.stringify({ app: "RKBACKLES", sessionId, guildId }) });
    const session = {
      sessionId, guildId, roomName, roomService: cfg.roomService, ownerUid: actorUid, startedAt, expiresAt, durationMinutes, publicOrigin,
      hostIdentity: `host_${crypto.createHash("sha256").update(String(actorUid)).digest("hex").slice(0, 12)}`,
      mutedIdentities: new Set(), muteAllActive: false, lastParticipantSnapshot: new Map(), endedAt: 0
    };
    try {
      sessions.set(guildId, session);
      setLivePresenceSafely(true);
      const invite = makeInvite(session);
      const hostAccess = await createAccessToken(session, session.hostIdentity, "RKBACKLES Host", "host");
      session.expiryTimer = setTimeout(() => endSession("custom live duration ended", "system").catch(err => console.error("Live Studio auto-end failed:", err.message)), Math.max(1000, expiresAt - Date.now()));
      session.expiryTimer.unref?.();
      addActivity("room_start", `Live Studio started for ${durationMinutes} minutes by admin ${actorUid}`);
      return { session, invite, hostAccess };
    } catch (err) {
      sessions.delete(guildId);
      setLivePresenceSafely(false);
      for (const [digest, invite] of invites) if (invite.sessionId === sessionId) invites.delete(digest);
      await cfg.roomService.deleteRoom(roomName).catch(() => {});
      throw err;
    }
  }

  // A minimal public route health response; never include LiveKit secrets or credentials.
  app.get("/api/live-studio/route-health", (req, res) => {
    const cfg = config();
    return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.39", configured: cfg.configured, missingVariables: cfg.missingVariables, panelOrigin: panelOriginFallback, pagesHostedOnPanel: ["/live-room.html"], publicStatusEndpoint: "/api/live-studio/public-status", ready: cfg.configured });
  });

  // Public, minimal read-only status for the Blogger live page. Do not expose participant
  // identities, room names, host credentials, tokens, or any LiveKit secret here.
  // The only public join URL is the deliberate, multi-use guest invite generated for this session.
  app.get("/api/live-studio/public-status", (req, res) => {
    const session = activeSession();
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.json({
      ok: true,
      version: "1.5.39",
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
  app.get("/api/admin/live-studio/status", async (req, res) => {
    try {
      await verifyAdminApiRequest(req);
      const session = activeSession();
      const participants = session ? await getParticipants(session) : [];
      const voice = getVoiceDirectory();
      let hostJoinUrl = "";
      if (session) hostJoinUrl = hostUrl(session, await createAccessToken(session, session.hostIdentity, "RKBACKLES Host", "host"));
      const radar = (await db.ref(radarRefPath).once("value").catch(() => null))?.val() || null;
      return res.set("Cache-Control", "no-store").json({ ok: true, version: "1.5.39", configured: config().configured, active: Boolean(session), session: session ? { sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: session.inviteUrl, inviteExpiresAt: session.inviteExpiresAt, participantCount: participants.length, screenShareCount: participants.filter(p => trackFlags(p.tracks).screenSharing).length, muteAllActive: session.muteAllActive } : null, participants: session ? participants.map(p => participantSummary(p, session)) : [], voiceChannels: voice.channels, discordVoiceMemberCount: voice.memberCount, hostJoinUrl, radar });
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
      return res.json({ ok: true, version: "1.5.39", active: true, sessionId: session.sessionId, roomName: session.roomName, startedAt: session.startedAt, expiresAt: session.expiresAt, durationMinutes: session.durationMinutes, inviteUrl: invite.inviteUrl, inviteCode: invite.inviteCode, maxUses: invite.maxUses, hostJoinUrl: hostUrl(session, hostAccess), radarPinsEnabled: pinAllTextChannels, publicOrigin: session.publicOrigin });
    } catch (err) { return apiError(res, err, "live_studio_start_failed"); }
  });
  app.post("/api/admin/live-studio/invite", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "live-studio-invite", 12, 60_000)) return;
      const session = activeSession();
      if (!session) throw Object.assign(new Error("Start Live Studio first"), { statusCode: 409, apiError: "live_studio_not_active" });
      const invite = makeInvite(session);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_invite_create", timestamp: Date.now(), summary: "Created multi-use invite for active Live Studio" }).catch(() => {});
      await publishRadar(true);
      return res.json({ ok: true, ...invite, sessionId: session.sessionId });
    } catch (err) { return apiError(res, err, "live_studio_invite_failed"); }
  });
  app.post("/api/admin/live-studio/end", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "live-studio-end", 10, 60_000)) return;
      const result = await endSession("ended by Firebase Admin", actor.uid);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_end", timestamp: Date.now(), summary: "Live Studio ended; invites revoked and radar messages removed" }).catch(() => {});
      return res.json({ ok: true, ...result });
    } catch (err) { return apiError(res, err, "live_studio_end_failed"); }
  });
  app.post("/api/live-studio/redeem", async (req, res) => {
    try {
      if (!checkCppRateLimit(req, res, "live-studio-redeem", 30, 60_000)) return;
      const code = String(req.body?.inviteCode || "");
      if (!isValidInviteCode(code)) throw Object.assign(new Error("Invite link is invalid. Return to the Admin Panel for an active link."), { statusCode: 400, apiError: "live_studio_invite_invalid" });
      const digest = inviteDigest(code), invite = invites.get(digest);
      if (!invite || invite.expiresAt <= Date.now()) { invites.delete(digest); throw Object.assign(new Error("Invite link is invalid or expired. Return to the Admin Panel for a current link."), { statusCode: 410, apiError: "live_studio_invite_expired" }); }
      const session = activeSession();
      if (!session || session.sessionId !== invite.sessionId) throw Object.assign(new Error("This Live Studio has ended. Return to the Admin Panel for a new link."), { statusCode: 410, apiError: "live_studio_not_active" });
      if (invite.uses >= invite.maxUses) throw Object.assign(new Error("This invite has reached its join limit."), { statusCode: 410, apiError: "live_studio_invite_exhausted" });
      invite.uses += 1;
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
      await publishRadar(true); return res.json({ ok: true, identity, muted });
    } catch (err) { return apiError(res, err, "live_studio_mute_failed"); }
  });
  app.post("/api/admin/live-studio/mute-all", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
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
      await publishRadar(true); return res.json({ ok: results.every(r => r.status === "fulfilled"), muted: session.muteAllActive, total: participants.length, permissionUpdates: results.filter(r => r.status === "fulfilled").length });
    } catch (err) { return apiError(res, err, "live_studio_mute_all_failed"); }
  });
  app.post("/api/admin/live-studio/kick", async (req, res) => {
    try {
      const actor = await verifyAdminApiRequest(req);
      if (!checkCppRateLimit(req, res, "live-studio-kick", 40, 60_000)) return;
      const session = activeSession(); if (!session) throw Object.assign(new Error("No active Live Studio"), { statusCode: 409, apiError: "live_studio_not_active" });
      const identity = String(req.body?.identity || ""); if (!identity.startsWith("guest_")) throw Object.assign(new Error("Cannot remove the room host"), { statusCode: 400, apiError: "invalid_studio_target" });
      await session.roomService.removeParticipant(session.roomName, identity);
      session.mutedIdentities.delete(identity); addActivity("participant_kicked", `${identity} removed by Admin`);
      await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_kick", timestamp: Date.now(), summary: `Removed Live Studio guest ${identity}` }).catch(() => {});
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

  client.on("ready", () => { addActivity("bot_ready", "Discord Bot online; Live Stream Radar is ready"); publishRadar(false).catch(() => {}); });
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
