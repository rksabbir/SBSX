"use strict";

const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { buildVoiceDirectorySnapshot, extractLiveConsoleTicketFromProtocols } = require("./live-console-policy");

function attachLiveConsoleServer(deps) {
    const { app, server, client, db, allowedGuildId, adminPanelOrigins, verifyAdminApiRequest,
        getReadyAdminGuild, adminApiError, checkCppRateLimit, getBotGuildMember,
        getConfiguredRoleId, PermissionFlagsBits, isProtectedDiscordTarget,
        adminVoiceSessions, liveStudioSessions, inspectLiveKitConfiguration, normalizeStudioName } = deps;
    const ticketTtlMs = 30_000;
    const tickets = new Map();
    const sockets = new Set();
    const wss = new WebSocketServer({
        noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false,
        handleProtocols: protocols => protocols.has("rkbackles-console-v1") ? "rkbackles-console-v1" : false
    });

    function makeSnapshot(guild) {
        const voiceSession = adminVoiceSessions.get(guild.id);
        const { voice } = require("@discordjs/voice");
        const botVoiceConnected = Boolean(voiceSession?.connection && voiceSession.connection.state.status === voice.VoiceConnectionStatus.Ready);
        const botMember = getBotGuildMember(guild);
        const adminRoleId = getConfiguredRoleId("admin");
        const canMute = Boolean(botMember?.permissions?.has(PermissionFlagsBits.MuteMembers));
        const canDisconnect = Boolean(botMember?.permissions?.has(PermissionFlagsBits.MoveMembers));
        const directory = buildVoiceDirectorySnapshot({
            guild, voiceSession: botVoiceConnected ? voiceSession : null, canMute, canDisconnect,
            isProtected: member => isProtectedDiscordTarget({
                targetId: member.id, ownerId: guild.ownerId,
                isAdministrator: Boolean(member.permissions?.has(PermissionFlagsBits.Administrator) || (adminRoleId && member.roles?.cache?.has(adminRoleId))),
                targetHighestRolePosition: member.roles?.highest?.position,
                botHighestRolePosition: botMember?.roles?.highest?.position
            })
        });
        const liveKit = inspectLiveKitConfiguration();
        const studio = liveStudioSessions.get(guild.id);
        return {
            type: "directory", version: "1.5.19", serverTime: Date.now(),
            guild: { id: guild.id, name: String(guild.name || "Discord server").slice(0, 120) },
            bot: { ready: Boolean(client.isReady()), voiceConnected: botVoiceConnected,
                channelId: botVoiceConnected ? voiceSession.channelId : "",
                channelName: botVoiceConnected ? String(voiceSession.channelName || "Voice channel") : "",
                connectionState: voiceSession?.connection?.state?.status || "disconnected" },
            permissions: { canMute, canDisconnect },
            liveKit: { configured: liveKit.configured, missingVariables: liveKit.missingVariables, urlValid: liveKit.urlValid,
                urlIssue: liveKit.urlIssue, dependencyInstalled: liveKit.dependencyInstalled, reason: liveKit.reason },
            liveStudio: { active: Boolean(studio && !studio.endedAt && studio.expiresAt > Date.now()),
                channelName: String(studio?.discordChannelName || ""), expiresAt: Number(studio?.expiresAt || 0) },
            ...directory
        };
    }
    function sendSnapshot(socket, guild) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try { socket.send(JSON.stringify(makeSnapshot(guild))); }
        catch (err) { console.warn("Live console snapshot failed:", String(err?.message || err).slice(0, 180)); }
    }
    function broadcast(guildId = allowedGuildId) {
        const guild = client.guilds.cache.get(String(guildId || ""));
        if (!guild || !sockets.size) return;
        for (const socket of sockets) if (socket.consoleRecord?.guildId === guild.id) sendSnapshot(socket, guild);
    }

    // The token is random, hashed at rest, single-use, and travels in the WebSocket subprotocol—not in URL logs.
    app.post("/api/admin/live-console/ticket", async (req, res) => {
        try {
            const actor = await verifyAdminApiRequest(req);
            if (!checkCppRateLimit(req, res, "admin-live-console-ticket", 30, 60_000)) return;
            const guild = await getReadyAdminGuild();
            const now = Date.now();
            for (const [digest, item] of tickets) if (item.expiresAt <= now) tickets.delete(digest);
            if (tickets.size >= 2000) throw Object.assign(new Error("Too many pending live console tickets"), { statusCode: 429, apiError: "rate_limited" });
            const ticket = crypto.randomBytes(32).toString("base64url");
            const digest = crypto.createHash("sha256").update(ticket).digest("hex");
            tickets.set(digest, { uid: actor.uid, guildId: guild.id, expiresAt: now + ticketTtlMs });
            return res.json({ ok: true, ticket, expiresAt: now + ticketTtlMs, wsPath: "/api/admin/live-console/stream" });
        } catch (err) { return adminApiError(res, err, "live_console_ticket_failed"); }
    });

    app.post("/api/admin/live-console/member-action", async (req, res) => {
        try {
            const actor = await verifyAdminApiRequest(req);
            if (!checkCppRateLimit(req, res, "admin-live-console-member-action", 20, 60_000)) return;
            const userId = String(req.body?.userId || "").trim();
            const action = String(req.body?.action || "").toLowerCase();
            if (!/^\d{15,20}$/.test(userId) || !["mute", "unmute", "disconnect"].includes(action)) {
                throw Object.assign(new Error("Invalid live voice moderation action"), { statusCode: 400, apiError: "invalid_voice_member_action" });
            }
            const guild = await getReadyAdminGuild();
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || !member.voice?.channelId) throw Object.assign(new Error("Member is not currently in a voice channel"), { statusCode: 404, apiError: "voice_member_not_found" });
            const botMember = getBotGuildMember(guild);
            const adminRoleId = getConfiguredRoleId("admin");
            const protectedTarget = isProtectedDiscordTarget({ targetId: member.id, ownerId: guild.ownerId,
                isAdministrator: Boolean(member.permissions?.has(PermissionFlagsBits.Administrator) || (adminRoleId && member.roles?.cache?.has(adminRoleId))),
                targetHighestRolePosition: member.roles?.highest?.position,
                botHighestRolePosition: botMember?.roles?.highest?.position });
            if (protectedTarget || member.user?.bot) throw Object.assign(new Error("Protected voice moderation target"), { statusCode: 403, apiError: "protected_voice_target" });
            if (["mute", "unmute"].includes(action) && !botMember?.permissions?.has(PermissionFlagsBits.MuteMembers)) throw Object.assign(new Error("Bot needs Mute Members"), { statusCode: 403, apiError: "missing_mute_members_permission" });
            if (action === "disconnect" && !botMember?.permissions?.has(PermissionFlagsBits.MoveMembers)) throw Object.assign(new Error("Bot needs Move Members"), { statusCode: 403, apiError: "missing_move_members_permission" });
            const channelName = member.voice.channel?.name || member.voice.channelId;
            if (action === "disconnect") await member.voice.disconnect("Admin panel by Firebase UID " + actor.uid + ": disconnect from " + channelName);
            else await member.voice.setMute(action === "mute", "Admin panel by Firebase UID " + actor.uid + ": " + action + " in " + channelName);
            await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "discord_voice_member_" + action, timestamp: Date.now(),
                summary: action + " voice member " + (member.user?.tag || member.id) + " (" + member.id + ") in " + channelName })
                .catch(err => console.error("Live console voice audit write failed:", err.message));
            broadcast(guild.id);
            return res.json({ ok: true, userId, action, channelId: member.voice?.channelId || null,
                name: normalizeStudioName(member.displayName || member.user?.username || member.id) });
        } catch (err) { return adminApiError(res, err, "voice_member_action_failed"); }
    });

    server.on("live-console-upgrade", (request, socket, head) => {
        const origin = String(request.headers.origin || "");
        if (!origin || !adminPanelOrigins.has(origin)) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        const ticket = extractLiveConsoleTicketFromProtocols(request.headers["sec-websocket-protocol"]);
        if (!ticket) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        const digest = crypto.createHash("sha256").update(ticket).digest("hex");
        const record = tickets.get(digest);
        tickets.delete(digest);
        if (!record || record.expiresAt <= Date.now() || record.guildId !== allowedGuildId) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        if (sockets.size >= 25) { socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request, record));
    });

    wss.on("connection", (socket, request, record) => {
        const guild = client.guilds.cache.get(record.guildId);
        if (!guild || !client.isReady()) { socket.close(1011, "Discord guild unavailable"); return; }
        socket.consoleRecord = record;
        sockets.add(socket);
        sendSnapshot(socket, guild);
        const authTimer = setInterval(async () => {
            try {
                const current = await db.ref("adminUids/" + record.uid).once("value");
                if (current.val() !== true) { socket.close(1008, "Admin access revoked"); return; }
            } catch (_) { socket.close(1011, "Admin authorization check unavailable"); }
        }, 30_000);
        if (typeof authTimer.unref === "function") authTimer.unref();
        socket.on("message", raw => {
            if (Buffer.byteLength(raw) > 128) { socket.close(1009, "Message too large"); return; }
            let message; try { message = JSON.parse(String(raw)); } catch (_) { return; }
            if (message?.type === "ping" && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "pong", serverTime: Date.now() }));
        });
        socket.once("close", () => { clearInterval(authTimer); sockets.delete(socket); });
        socket.once("error", err => console.warn("Live console socket error:", String(err?.message || err).slice(0, 180)));
    });

    const heartbeat = setInterval(() => { if (sockets.size && client.isReady()) broadcast(allowedGuildId); }, 5000);
    if (typeof heartbeat.unref === "function") heartbeat.unref();
    client.on("voiceStateUpdate", (_oldState, newState) => { if (newState.guild?.id === allowedGuildId) broadcast(newState.guild.id); });
    client.on("guildChannelCreate", channel => { if (channel.guild?.id === allowedGuildId) broadcast(channel.guild.id); });
    client.on("guildChannelDelete", channel => { if (channel.guild?.id === allowedGuildId) broadcast(channel.guild.id); });
    client.on("guildChannelUpdate", (_oldChannel, channel) => { if (channel.guild?.id === allowedGuildId) broadcast(channel.guild.id); });
    client.on("guildMemberUpdate", (_oldMember, member) => { if (member.guild?.id === allowedGuildId) broadcast(member.guild.id); });
    return { broadcast };
}

module.exports = { attachLiveConsoleServer };
