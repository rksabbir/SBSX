"use strict";

const MAX_VOICE_CHANNELS = 100;
const MAX_MEMBERS_PER_CHANNEL = 200;

function extractLiveConsoleTicketFromProtocols(header) {
    const protocols = String(header || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!protocols.includes("rkbackles-console-v1")) return null;
    const ticketProtocol = protocols.find(value => value.startsWith("rkbackles-console-ticket."));
    const ticket = ticketProtocol ? ticketProtocol.slice("rkbackles-console-ticket.".length) : "";
    return /^[A-Za-z0-9_-]{40,60}$/.test(ticket) ? ticket : null;
}

function buildVoiceDirectorySnapshot({ guild, voiceSession = null, canMute = false, canDisconnect = false, isProtected = () => false, now = Date.now() }) {
    if (!guild || !guild.channels?.cache || !guild.voiceStates?.cache) throw new TypeError("A cached Discord guild is required");
    const states = [...guild.voiceStates.cache.values()];
    const channels = [...guild.channels.cache.values()]
        .filter(channel => typeof channel?.isVoiceBased === "function" && channel.isVoiceBased())
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .slice(0, MAX_VOICE_CHANNELS)
        .map(channel => {
            const members = states.filter(state => state.channelId === channel.id && state.member)
                .slice(0, MAX_MEMBERS_PER_CHANNEL)
                .map(state => {
                    const member = state.member;
                    const protectedTarget = Boolean(isProtected(member));
                    return {
                        id: String(member.id || state.id || ""),
                        name: String(member.displayName || member.user?.globalName || member.user?.username || member.id || "Discord member").slice(0, 100),
                        username: String(member.user?.username || "").slice(0, 80),
                        avatar: typeof member.displayAvatarURL === "function" ? member.displayAvatarURL({ size: 64 }) : "",
                        muted: Boolean(state.serverMute), deafened: Boolean(state.serverDeaf),
                        selfMuted: Boolean(state.selfMute), selfDeafened: Boolean(state.selfDeaf),
                        isBot: Boolean(member.user?.bot), protectedTarget,
                        canMute: Boolean(canMute && !protectedTarget && !member.user?.bot),
                        canDisconnect: Boolean(canDisconnect && !protectedTarget && !member.user?.bot)
                    };
                });
            return {
                id: String(channel.id), name: String(channel.name || "Voice channel").slice(0, 100),
                type: String(channel.type === 13 || /stage/i.test(String(channel.typeName || "")) ? "stage" : "voice"),
                bitrate: Number(channel.bitrate || 0), userLimit: Number(channel.userLimit || 0),
                botJoined: Boolean(voiceSession?.channelId === channel.id),
                memberCount: members.length, members
            };
        });
    return {
        channels,
        totals: { channelCount: channels.length, memberCount: channels.reduce((sum, channel) => sum + channel.memberCount, 0), botChannelId: String(voiceSession?.channelId || ""), updatedAt: now }
    };
}

module.exports = { extractLiveConsoleTicketFromProtocols, buildVoiceDirectorySnapshot };
