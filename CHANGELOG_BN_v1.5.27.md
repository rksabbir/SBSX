# RKBACKLES v1.5.27 — Changelog

- Discord OAuth2 sign-in added for Live Studio invite redemption (`identify` + `guilds.members.read`).
- Invitees are verified as members of the configured Discord guild before room entry.
- Multi-use participant invitations allow microphone, screen/window/tab sharing, and received live audio/video.
- Added fullscreen screen-stage controls.
- Added role/user-ID-based server-validated room moderation: participant list, mute/unmute, mute everyone/unmute everyone, kick, create invite, and end room.
- Guild owner and Discord Administrator are room moderators by default; additional Discord user/role IDs use Render environment allowlists.
- OAuth and LiveKit secrets remain server-side.
- Fixed v1.5.26 packaging path expectations: `index.js` and `public/` are adjacent in root deployment ZIP; full project uses `discord-bot/index.js` and `discord-bot/public/`.
