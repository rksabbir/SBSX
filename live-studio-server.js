"use strict";
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { isValidInviteCode, inviteDigest, participantName, normalizeTrackSource, isMicrophoneTrack, shouldShowInRadar, buildRadarMessage } = require("./live-studio-core");

function attachLiveStudioServer({ app, client, db, guildId, verifyAdminApiRequest, checkCppRateLimit, ChannelType }) {
  const sessions = new Map(), invites = new Map(), activities = [];
  const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://sbsx.onrender.com").trim().replace(/\/+$/, "");
  const maxParticipants = Math.max(2, Math.min(100, Number(process.env.LIVE_STUDIO_MAX_PARTICIPANTS || 20)));
  const sessionTtl = Math.max(15 * 60_000, Math.min(8 * 60 * 60_000, Number(process.env.LIVE_STUDIO_MAX_DURATION_MS || 4 * 60 * 60_000)));
  const inviteTtl = Math.min(sessionTtl, Math.max(5 * 60_000, Number(process.env.LIVE_STUDIO_INVITE_TTL_MS || sessionTtl)));
  const maxInviteUses = Math.max(maxParticipants, Math.min(100_000, Number(process.env.LIVE_STUDIO_MAX_INVITE_USES || 10_000)));
  const pinAll = String(process.env.LIVE_STREAM_RADAR_PIN_ALL_TEXT_CHANNELS ?? "true").toLowerCase() !== "false";
  const radarPath = "runtime/liveStreamRadar", pinsPath = "runtime/liveStreamRadarPins";
  let lk = null, radarBusy = false, pinBusy = false, lastFingerprint = "";

  function config() {
    const url = String(process.env.LIVEKIT_URL || "wss://sabbir-ylq7x559.livekit.cloud").trim().replace(/\/+$/, "");
    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim(), apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
    const missing = [];
    if (!apiKey) missing.push("LIVEKIT_API_KEY"); if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
    let httpUrl = "";
    try { const u = new URL(url); if (u.protocol === "wss:") u.protocol = "https:"; else if (u.protocol === "ws:") u.protocol = "http:"; if (!/^https?:$/.test(u.protocol)) throw Error(); httpUrl = u.toString().replace(/\/$/, ""); } catch (_) { missing.push("valid LIVEKIT_URL"); }
    return { url, httpUrl, apiKey, apiSecret, missing, configured: missing.length === 0 };
  }
  function runtime() {
    const c = config(); if (!c.configured) throw Object.assign(new Error("LiveKit credentials missing"), { statusCode: 503, apiError: "livekit_not_configured", missingVariables: c.missing });
    if (!lk) { const { RoomServiceClient } = require("livekit-server-sdk"); lk = { ...c, service: new RoomServiceClient(c.httpUrl, c.apiKey, c.apiSecret) }; }
    return lk;
  }
  function addActivity(type, summary, extra = {}) { const item = { id: crypto.randomBytes(6).toString("hex"), type, summary: String(summary || "").replace(/[\r\n\0]+/g, " ").slice(0, 200), at: Date.now(), ...extra }; activities.unshift(item); if (activities.length > 30) activities.length = 30; return item; }
  function active() { const s = sessions.get(guildId); return s && !s.endedAt && s.expiresAt > Date.now() ? s : null; }
  function fail(res, err, fallback) { const status = Number(err?.statusCode) || 500; if (status >= 500) console.error("Live Studio API failed:", String(err?.apiError || fallback), String(err?.message || "").slice(0, 220)); return res.status(status).json({ ok: false, error: String(err?.apiError || fallback), message: String(err?.message || "Request failed").slice(0, 240), ...(Array.isArray(err?.missingVariables) ? { missingVariables: err.missingVariables } : {}) }); }
  async function makeToken(session, identity, name, role, ttl = "4h") {
    const { AccessToken } = require("livekit-server-sdk"), c = runtime();
    const token = new AccessToken(c.apiKey, c.apiSecret, { identity, name: participantName(name), ttl, metadata: JSON.stringify({ app: "RKBACKLES", sessionId: session.sessionId, role }) });
    const sources = role === "guest" && session.muteAllActive ? [3, 4] : [2, 3, 4];
    token.addGrant({ roomJoin: true, room: session.roomName, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: sources });
    return { token: await token.toJwt(), serverUrl: c.url };
  }
  function createInvite(session) {
    const code = crypto.randomBytes(32).toString("base64url"), expiresAt = Math.min(session.expiresAt, Date.now() + inviteTtl);
    invites.set(inviteDigest(code), { sessionId: session.sessionId, guildId, expiresAt, uses: 0, maxUses: maxInviteUses });
    session.inviteCode = code; session.inviteUrl = `${baseUrl}/live-room?invite=${encodeURIComponent(code)}`; session.inviteExpiresAt = expiresAt;
    return { inviteCode: code, inviteUrl: session.inviteUrl, expiresAt, maxUses: maxInviteUses };
  }
  function hostUrl(session, token) { return `${baseUrl}/live-room#${new URLSearchParams({ token: token.token, serverUrl: token.serverUrl, room: session.roomName, role: "host", name: "RKBACKLES Host", sessionId: session.sessionId })}`; }
  async function getParticipants(session) { if (!session) return []; try { return await session.service.listParticipants(session.roomName); } catch (e) { if (/not found|does not exist/i.test(String(e.message || ""))) return []; throw e; } }
  function safeParticipant(p, session) { const tracks = Array.isArray(p.tracks) ? p.tracks : []; const mics = tracks.filter(isMicrophoneTrack); return { identity: String(p.identity || "").slice(0, 120), name: String(p.name || p.identity || "Guest").slice(0, 80), role: p.identity === session.hostIdentity ? "host" : "guest", micMuted: session.muted.has(String(p.identity)) || (mics.length > 0 && mics.every(t => t.muted)), micActive: mics.some(t => !t.muted), screenSharing: tracks.some(t => { const source = normalizeTrackSource(t.source); return [3,4].includes(source) || (typeof source === "string" && /screen_share|screenshare/.test(source)); }) }; }
  async function enforceMutes(session, participants) { const service = runtime().service; for (const p of participants) { const id = String(p.identity || ""); if (id === session.hostIdentity || !(session.muteAll || session.muted.has(id))) continue; for (const t of p.tracks || []) if (isMicrophoneTrack(t) && !t.muted) await service.mutePublishedTrack(session.roomName, id, t.sid, true).catch(() => {}); } }
  function voiceSnapshot() {
    const guild = client.guilds.cache.get(guildId); if (!guild) return { guildName: "Discord server", channels: [], count: 0 };
    const channels = []; let count = 0;
    for (const ch of guild.channels.cache.values()) if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(ch.type)) {
      const members = [...(ch.members?.values?.() || [])].map(m => ({ id: m.id, name: String(m.displayName || m.user?.username || m.id).slice(0, 80), bot: Boolean(m.user?.bot), muted: Boolean(m.voice?.serverMute || m.voice?.selfMute), deafened: Boolean(m.voice?.serverDeaf || m.voice?.selfDeaf) }));
      count += members.length; channels.push({ id: ch.id, name: String(ch.name || "Voice channel").slice(0, 100), type: ch.type === ChannelType.GuildStageVoice ? "stage" : "voice", memberCount: members.length, members });
    }
    channels.sort((a,b) => a.name.localeCompare(b.name)); return { guildName: String(guild.name || "Discord server").slice(0, 120), channels, count };
  }
  async function syncPinned(guild, text, fingerprint) {
    if (!pinAll || pinBusy || !guild) return; pinBusy = true;
    try {
      const ref = db.ref(pinsPath), saved = (await ref.once("value").catch(() => null))?.val() || {};
      for (const ch of guild.channels.cache.values()) {
        if (!shouldShowInRadar(ch)) continue;
        let record = saved[ch.id], message = record?.messageId ? await ch.messages.fetch(String(record.messageId)).catch(() => null) : null;
        // After a redeploy, the Firebase message index may be missing while the old pinned message still exists.
        // Reuse that message rather than creating a duplicate radar post.
        if (!message && !record) {
          const pinned = typeof ch.messages.fetchPinned === "function" ? await ch.messages.fetchPinned().catch(() => null) : null;
          message = pinned?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
          if (!message) {
            const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
            message = recent?.find?.(m => m.author?.id === client.user?.id && /LIVE STREAM RADAR/.test(String(m.content || ""))) || null;
          }
          if (message) record = { messageId: message.id, pinned: Boolean(message.pinned), channelName: String(ch.name || "").slice(0,100), fingerprint: "", createdAt: message.createdTimestamp || Date.now() };
        }
        if (message) {
          if (record?.fingerprint !== fingerprint) await message.edit({ content: text, allowedMentions: { parse: [] } }).catch(e => console.warn("Radar edit failed", ch.id, e.message));
          if (record?.pinned === false) await message.pin("RKBACKLES LIVE STREAM RADAR — persistent status").then(() => { record.pinned = true; }).catch(e => console.warn("Radar repin denied", ch.id, e.message));
        } else {
          try { message = await ch.send({ content: text, allowedMentions: { parse: [] } }); let pinned = false; try { await message.pin("RKBACKLES LIVE STREAM RADAR — persistent status"); pinned = true; } catch (e) { console.warn("Radar pin denied", ch.id, e.message); } record = { messageId: message.id, pinned, channelName: String(ch.name || "").slice(0,100), fingerprint, createdAt: Date.now() }; await ref.child(ch.id).set(record).catch(() => {}); saved[ch.id] = record; await new Promise(r => setTimeout(r,250)); continue; } catch (e) { console.warn("Radar post denied", ch.id, e.message); continue; }
        }
        if (record) { record = { ...record, channelName: String(ch.name || "").slice(0,100), fingerprint, lastSyncAt: Date.now() }; await ref.child(ch.id).update(record).catch(() => {}); saved[ch.id] = record; }
      }
    } finally { pinBusy = false; }
  }
  async function endSession(reason = "ended", actor = "admin") {
    const s = sessions.get(guildId); if (!s || s.endedAt) return { active: false };
    s.endedAt = Date.now(); if (s.timer) clearTimeout(s.timer); sessions.delete(guildId);
    for (const [digest, invite] of invites) if (invite.sessionId === s.sessionId) invites.delete(digest);
    await s.service.deleteRoom(s.roomName).catch(e => console.warn("LiveKit room delete failed", e.message));
    addActivity("room_end", `Live Studio ended: ${reason}`, { actor }); return { active: false, sessionId: s.sessionId };
  }
  async function publishRadar(forcePin = false) {
    if (radarBusy) return; radarBusy = true;
    try {
      const voice = voiceSnapshot(); let s = active(); const stored = sessions.get(guildId);
      if (!s && stored && !stored.endedAt && stored.expiresAt <= Date.now()) { await endSession("session expired", "system"); s = null; }
      let ps = s ? await getParticipants(s).catch(e => { console.warn("Radar participant poll failed", e.message); return []; }) : [];
      if (s) await enforceMutes(s, ps).catch(e => console.warn("Live mute enforcement failed", e.message));
      const nowParticipants = new Map(ps.map(p => [String(p.identity), p]));
      if (s) {
        const previous = s.lastParticipants || new Map();
        const stateOf = p => { const safe = safeParticipant(p, s); return { micMuted: safe.micMuted, screenSharing: safe.screenSharing, trackCount: Array.isArray(p.tracks) ? p.tracks.length : 0 }; };
        for (const [id, p] of nowParticipants) {
          if (!previous.has(id)) addActivity("live_join", `${p.name || id} joined Live Studio`);
          else {
            const before = stateOf(previous.get(id)), after = stateOf(p);
            if (before.screenSharing !== after.screenSharing) addActivity(after.screenSharing ? "screen_share_start" : "screen_share_stop", `${p.name || id} ${after.screenSharing ? "started" : "stopped"} screen sharing`);
            if (before.micMuted !== after.micMuted) addActivity(after.micMuted ? "mic_muted" : "mic_unmuted", `${p.name || id} microphone ${after.micMuted ? "muted" : "unmuted"}`);
            else if (before.micActive !== after.micActive) addActivity(after.micActive ? "mic_publish_start" : "mic_publish_stop", `${p.name || id} microphone ${after.micActive ? "started" : "stopped"}`);
            if (before.trackCount !== after.trackCount && before.screenSharing === after.screenSharing && before.micActive === after.micActive && before.micMuted === after.micMuted) addActivity("media_track_change", `${p.name || id} media tracks updated (${after.trackCount})`);
          }
        }
        for (const [id, p] of previous) if (!nowParticipants.has(id)) addActivity("live_leave", `${p.name || id} left Live Studio`);
        s.lastParticipants = nowParticipants;
      }
      const latest = activities[0] || { id: "initial", summary: "Waiting for activity", at: Date.now() };
      const pinSnap = await db.ref(pinsPath).once("value").catch(() => null); const pinRecords = Object.values(pinSnap?.val() || {}); const pinCount = pinRecords.filter(record => record?.pinned === true).length;
      const data = { version: "1.5.28", guildId, guildName: voice.guildName, active: Boolean(s), updatedAt: Date.now(), latestActivityAt: latest.at,
        session: s ? { sessionId: s.sessionId, roomName: s.roomName, startedAt: s.startedAt, expiresAt: s.expiresAt, inviteUrl: s.inviteUrl, inviteExpiresAt: s.inviteExpiresAt, participantCount: ps.length, muteAll: s.muteAll } : null,
        discord: { voiceMemberCount: voice.count, channels: voice.channels }, liveParticipants: ps.map(p => safeParticipant(p,s)), activity: activities.slice(0,25), radar: { pinAllTextChannels: pinAll, pinnedMessageCount: pinCount } };
      await db.ref(radarPath).set(data).catch(e => console.error("Radar Firebase update failed", e.message));
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ active: data.active, session: s?.sessionId || "", people: ps.map(p => { const st = safeParticipant(p, s || { muted: new Set(), muteAll: false, hostIdentity: "" }); return [p.identity, st.micMuted, st.micActive, st.screenSharing, (p.tracks || []).length]; }).sort((a,b) => String(a[0]).localeCompare(String(b[0]))), channels: voice.channels.map(c => [c.id,c.name,c.memberCount,c.members.map(m=>[m.id,m.muted,m.deafened])]), latest: latest.id || latest.at, invite: s?.inviteUrl || "" })).digest("hex");
      if (forcePin || fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; await syncPinned(client.guilds.cache.get(guildId), buildRadarMessage({ guildName: voice.guildName, active: Boolean(s), inviteUrl: s?.inviteUrl || "", participantCount: ps.length, voiceMemberCount: voice.count, updatedAt: latest.at || s?.startedAt || Date.now(), latestActivity: latest.summary }), fingerprint); }
    } catch (e) { console.error("LIVE STREAM RADAR refresh failed:", String(e.message || e).slice(0,220)); }
    finally { radarBusy = false; }
  }
  async function startSession(actorUid) {
    const old = sessions.get(guildId); if (old && !old.endedAt && old.expiresAt <= Date.now()) await endSession("expired before restart", "system");
    if (active()) throw Object.assign(new Error("Live Studio is already active"), { statusCode: 409, apiError: "live_studio_already_active" });
    const cfg = runtime(), sessionId = crypto.randomBytes(12).toString("base64url"), roomName = `rkbs_${guildId}_${crypto.randomBytes(7).toString("hex")}`;
    await cfg.service.createRoom({ name: roomName, emptyTimeout: 90, maxParticipants, metadata: JSON.stringify({ app: "RKBACKLES", sessionId, guildId }) });
    const s = { sessionId, guildId, roomName, service: cfg.service, ownerUid: actorUid, startedAt: Date.now(), expiresAt: Date.now()+sessionTtl,
      hostIdentity: `host_${crypto.createHash("sha256").update(String(actorUid)).digest("hex").slice(0,12)}`, muted: new Set(), muteAll: false, denied: new Set(), lastParticipants: new Map(), endedAt: 0 };
    try { sessions.set(guildId,s); const invite=createInvite(s), hostToken=await makeToken(s,s.hostIdentity,"RKBACKLES Host","host"); s.timer=setTimeout(()=>endSession("maximum duration reached","system").then(()=>publishRadar(true)).catch(()=>{}),sessionTtl); s.timer.unref?.(); addActivity("room_start",`Live Studio started by Firebase admin ${actorUid}`); return { session:s, invite, hostToken }; }
    catch(e) { sessions.delete(guildId); for(const [d,i] of invites)if(i.sessionId===sessionId)invites.delete(d); await cfg.service.deleteRoom(roomName).catch(()=>{}); throw e; }
  }
  function hostUrl(s, access) { return `${baseUrl}/live-room#${new URLSearchParams({ token: access.token, serverUrl: access.serverUrl, room: s.roomName, role: "host", name: "RKBACKLES Host", sessionId: s.sessionId })}`; }
  function statusPayload(s=active()) { const c=config(); return { ok:true, version:"1.5.33", configured:c.configured, missingVariables:c.missing, active:Boolean(s), session:s?{sessionId:s.sessionId,roomName:s.roomName,startedAt:s.startedAt,expiresAt:s.expiresAt,inviteUrl:s.inviteUrl,muteAll:s.muteAll}:null }; }

  app.get("/api/live-studio/route-health",(req,res)=>{const c=config(),p=path.join(__dirname,"public");const pages={liveRoom:fs.existsSync(path.join(p,"live-room.html")),discordShareStudio:fs.existsSync(path.join(p,"discord-share-studio.html"))};return res.set("Cache-Control","no-store").json({ok:true,version:"1.5.33",configured:c.configured,missingVariables:c.missing,pages,ready:pages.liveRoom&&pages.discordShareStudio&&c.configured});});
  for (const [route,file] of [["/live-room","live-room.html"],["/discord-share-studio","discord-share-studio.html"]]) app.get(route,(req,res)=>{const p=path.join(__dirname,"public",file);if(!fs.existsSync(p))return res.status(503).type("text/plain; charset=utf-8").send(`Missing public/${file}; deploy complete v1.5.28 public folder.`);res.set({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});return res.sendFile(p);});
  app.get("/api/admin/live-studio/status",async(req,res)=>{try{await verifyAdminApiRequest(req);const s=active(),ps=s?await getParticipants(s):[],radar=(await db.ref(radarPath).once("value").catch(()=>null))?.val()||null;const payload={...statusPayload(s),participants:s?ps.map(p=>safeParticipant(p,s)):[],radar};if(s){const hostToken=await makeToken(s,s.hostIdentity,"RKBACKLES Host","host");payload.hostJoinUrl=hostUrl(s,hostToken);}return res.set("Cache-Control","no-store").json(payload);}catch(e){return fail(res,e,"live_studio_status_failed");}});
  app.post("/api/admin/live-studio/start",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-start",6,60000))return;const {session,invite,hostToken}=await startSession(actor.uid);await db.ref("auditLog").push({adminUid:actor.uid,actionType:"live_studio_start",timestamp:Date.now(),summary:`Live Studio started; participant invite pinned in eligible Discord channels`}).catch(()=>{});await publishRadar(true);return res.json({ok:true,version:"1.5.33",active:true,sessionId:session.sessionId,roomName:session.roomName,startedAt:session.startedAt,expiresAt:session.expiresAt,inviteUrl:invite.inviteUrl,inviteCode:invite.inviteCode,maxUses:invite.maxUses,hostJoinUrl:hostUrl(session,hostToken),radarPinsEnabled:pinAll});}catch(e){return fail(res,e,"live_studio_start_failed");}});
  app.post("/api/admin/live-studio/invite",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-invite",12,60000))return;const s=active();if(!s)throw Object.assign(new Error("Start Live Studio first"),{statusCode:409,apiError:"live_studio_not_active"});const invite=createInvite(s);await db.ref("auditLog").push({adminUid:actor.uid,actionType:"live_studio_invite_create",timestamp:Date.now(),summary:`Created multi-use Live Studio participant invite`}).catch(()=>{});await publishRadar(true);return res.json({ok:true,...invite,sessionId:s.sessionId});}catch(e){return fail(res,e,"live_studio_invite_failed");}});
  app.post("/api/admin/live-studio/end",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-end",10,60000))return;const result=await endSession("ended by Firebase admin",actor.uid);await db.ref("auditLog").push({adminUid:actor.uid,actionType:"live_studio_end",timestamp:Date.now(),summary:`Live Studio ended`}).catch(()=>{});await publishRadar(true);return res.json({ok:true,...result});}catch(e){return fail(res,e,"live_studio_end_failed");}});
  app.post("/api/live-studio/redeem",async(req,res)=>{try{if(!checkCppRateLimit(req,res,"live-studio-redeem",30,60000))return;const code=String(req.body?.inviteCode||"");if(!isValidInviteCode(code))throw Object.assign(new Error("Invite code is invalid"),{statusCode:400,apiError:"live_studio_invite_invalid"});const d=inviteDigest(code),inv=invites.get(d);if(!inv||inv.expiresAt<=Date.now()||inv.guildId!==guildId){invites.delete(d);throw Object.assign(new Error("Invite expired or invalid"),{statusCode:410,apiError:"live_studio_invite_expired"});}const s=active();if(!s||s.sessionId!==inv.sessionId)throw Object.assign(new Error("Live Studio is not active"),{statusCode:410,apiError:"live_studio_not_active"});if(inv.uses>=inv.maxUses)throw Object.assign(new Error("Invite has reached its admission limit"),{statusCode:410,apiError:"live_studio_invite_exhausted"});inv.uses+=1;const identity=`guest_${crypto.randomBytes(12).toString("hex")}`,name=participantName(req.body?.displayName,"Live guest"),access=await makeToken(s,identity,name,"guest");addActivity("invite_join",`${name} redeemed a participant invite`);await publishRadar(false);return res.json({ok:true,sessionId:s.sessionId,roomName:s.roomName,identity,name,role:"guest",...access});}catch(e){return res.status(Number(e.statusCode)||500).json({ok:false,error:String(e.apiError||"live_studio_redeem_failed"),message:String(e.message||"Could not join").slice(0,240)});}});
  app.post("/api/admin/live-studio/mute",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-mute",60,60000))return;const s=active();if(!s)throw Object.assign(new Error("No active Live Studio"),{statusCode:409,apiError:"live_studio_not_active"});const id=String(req.body?.identity||"");if(!id.startsWith("guest_"))throw Object.assign(new Error("Only guests can be muted"),{statusCode:400,apiError:"invalid_studio_target"});const ps=await getParticipants(s),p=ps.find(x=>String(x.identity)===id);if(!p)throw Object.assign(new Error("Participant not found"),{statusCode:404,apiError:"studio_participant_not_found"});const muted=req.body?.muted!==false;if(muted)s.muted.add(id);else s.muted.delete(id);const allowedSources=(muted||s.muteAll)?[3,4]:[2,3,4];await s.service.updateParticipant(s.roomName,id,{permission:{canPublish:true,canSubscribe:true,canPublishData:true,canPublishSources:allowedSources}});await enforceMutes(s,[p]);addActivity(muted?"participant_muted":"participant_unmuted",`${id} mic ${muted?"muted":"unmuted"}`);await db.ref("auditLog").push({adminUid:actor.uid,actionType:muted?"live_studio_mute":"live_studio_unmute",timestamp:Date.now(),summary:`${muted?"Muted":"Unmuted"} Live Studio participant ${id}`}).catch(()=>{});await publishRadar(true);return res.json({ok:true,identity:id,muted});}catch(e){return fail(res,e,"live_studio_mute_failed");}});
  app.post("/api/admin/live-studio/mute-all",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-mute-all",12,60000))return;const s=active();if(!s)throw Object.assign(new Error("No active Live Studio"),{statusCode:409,apiError:"live_studio_not_active"});s.muteAll=req.body?.muted!==false;const ps=(await getParticipants(s)).filter(p=>String(p.identity)!==s.hostIdentity);if(s.muteAll)for(const p of ps)s.muted.add(String(p.identity));else s.muted.clear();const allowedSources=s.muteAll?[3,4]:[2,3,4];const permissionResults=await Promise.allSettled(ps.map(p=>s.service.updateParticipant(s.roomName,String(p.identity),{permission:{canPublish:true,canSubscribe:true,canPublishData:true,canPublishSources:allowedSources}})));await enforceMutes(s,ps);addActivity(s.muteAll?"mute_all":"unmute_all",`${s.muteAll?"Mute everyone enabled":"Mute everyone disabled"} (${ps.length})`);await db.ref("auditLog").push({adminUid:actor.uid,actionType:s.muteAll?"live_studio_mute_all":"live_studio_unmute_all",timestamp:Date.now(),summary:`${s.muteAll?"Muted":"Unmuted"} all guests (${ps.length}); permissionUpdates=${permissionResults.filter(r=>r.status==="fulfilled").length}/${ps.length}`}).catch(()=>{});await publishRadar(true);return res.json({ok:permissionResults.every(r=>r.status==="fulfilled"),muted:s.muteAll,total:ps.length,permissionUpdates:permissionResults.filter(r=>r.status==="fulfilled").length});}catch(e){return fail(res,e,"live_studio_mute_all_failed");}});
  app.post("/api/admin/live-studio/kick",async(req,res)=>{try{const actor=await verifyAdminApiRequest(req);if(!checkCppRateLimit(req,res,"live-studio-kick",40,60000))return;const s=active();if(!s)throw Object.assign(new Error("No active Live Studio"),{statusCode:409,apiError:"live_studio_not_active"});const id=String(req.body?.identity||"");if(!id.startsWith("guest_"))throw Object.assign(new Error("Cannot remove host"),{statusCode:400,apiError:"invalid_studio_target"});const ps=await getParticipants(s);if(!ps.some(p=>String(p.identity)===id))throw Object.assign(new Error("Participant not found"),{statusCode:404,apiError:"studio_participant_not_found"});await s.service.removeParticipant(s.roomName,id,{revokeTokenTs:BigInt(Math.floor(Date.now()/1000))});addActivity("participant_kicked",`${id} removed by Admin`);await db.ref("auditLog").push({adminUid:actor.uid,actionType:"live_studio_kick",timestamp:Date.now(),summary:`Removed Live Studio guest ${id}`}).catch(()=>{});await publishRadar(true);return res.json({ok:true,identity:id});}catch(e){return fail(res,e,"live_studio_kick_failed");}});

  client.on("ready",()=>{addActivity("bot_ready","Discord Bot online; LIVE STREAM RADAR is running");publishRadar(true).catch(()=>{});});
  client.on("voiceStateUpdate",(oldState,newState)=>{if(newState.guild?.id!==guildId)return;const m=newState.member||oldState.member,n=String(m?.displayName||m?.user?.username||m?.id||"Member").slice(0,80);if(!oldState.channelId&&newState.channelId)addActivity("voice_join",`${n} joined ${newState.channel?.name||"a voice channel"}`);else if(oldState.channelId&&!newState.channelId)addActivity("voice_leave",`${n} left ${oldState.channel?.name||"a voice channel"}`);else if(oldState.channelId!==newState.channelId)addActivity("voice_move",`${n} moved to ${newState.channel?.name||"another voice channel"}`);else if(Boolean(oldState.serverMute||oldState.selfMute)!==Boolean(newState.serverMute||newState.selfMute))addActivity("voice_mute",`${n} microphone ${newState.serverMute||newState.selfMute?"muted":"unmuted"}`);publishRadar(false).catch(()=>{});});
  for(const event of ["channelCreate","channelDelete","channelUpdate"])client.on(event,(a,b)=>{const c=b||a;if(c?.guild?.id===guildId)publishRadar(false).catch(()=>{});});
  const timer=setInterval(()=>publishRadar(false).catch(()=>{}),4000);timer.unref?.();
  return { sessions, invites, publishRadar, endSession };
}
module.exports = { attachLiveStudioServer };
