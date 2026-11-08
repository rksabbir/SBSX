# RKBACKLES v1.5.37 — Admin Panel Live V6 + LIVE STREAM RADAR

এই build-এ আগের Payment Bot, Transactions, Orders, Coupon, C++ Account ও Reader features রেখে Invite-based Live Studio ও Live Stream Radar একীভূত করা হয়েছে।

## নতুন
- `LIVE STREAM RADAR` Admin Panel tab — Firebase Realtime Database থেকে auto-sync, page reload লাগে না।
- Custom live duration 5–480 মিনিট; নির্ধারিত সময়ে room auto-end হয়।
- Invite link সবসময় Admin Panel origin থেকে তৈরি: `https://admin-9x7v1.wuaze.com/live-room.html?invite=...`.
- Multi-use invite; invalid/expired হলে error ও `Back to Admin Panel` link।
- Mic, screen/window/game share, 480p–2160p quality choices, browser fullscreen, live activity.
- Screen sharing count, LiveKit participant list, all Discord Voice/Stage channel lists ও member counts.
- Firebase-admin protected Live Studio mute/unmute/mute-all/kick/end actions; Discord voice channel mute/unmute/deafen/undeafen/disconnect if Bot permissions allow.
- During a live session one Radar announcement is sent/pinned per eligible sendable Discord text channel and edited in place. When session ends, current invites are revoked, LiveKit room is deleted, and Bot-owned radar messages are unpinned/deleted. No mass-DM is sent; channel messages broadcast the event.
- `canPublishSources` uses numeric LiveKit TrackSource enum values (`2`, `3`, `4`), not strings, to avoid `Cannot convert TrackSource microphone to string`.

## Main paths
- `admin-panel/blogger-admin-panel.html` — Admin Panel source. Upload as `index.html` to InfinityFree `htdocs/`.
- `discord-bot/public/live-room.html` — public invitation page. Upload as `live-room.html` to the same InfinityFree `htdocs/` folder.
- `discord-bot/live-studio-server.js` — LiveKit / Radar HTTP routes.
- `discord-bot/live-studio-core.js` — invite, TrackSource, duration and radar helpers.
- `firebase/database.rules.json` — existing Firebase Database rules. Keep admin UID protections.

## Limitations
- This is a LiveKit browser room, not Discord's native Go Live stream tile. The Admin Panel lists all current Discord voice/stage channels and can moderate voice members where the Bot has required Discord permissions; a single Discord Bot instance cannot join multiple voice channels at once.
- It does not DM every Discord member. It posts/updates a pinned live message in each eligible text/announcement channel it can access.
- Session/invite state is in process memory. Restarting/redeploying the Bot invalidates active invites and deletes stale bot-owned Radar pins during cleanup.
- Deployment and live device/browser behavior still need to be tested in the actual hosting accounts.

## Blogger Live Status Widget
- File: `RKBACKLES_Blogger_Live_Status_Widget_v1.5.37.html` is included beside the project package. Add it in Blogger → Layout → HTML/JavaScript gadget.
- The widget calls `https://sbsx.onrender.com/api/live-studio/public-status` every 5 seconds. It does not refresh the page.
- Make sure Render environment variable `ADMIN_PANEL_ORIGINS` includes both `https://admin-9x7v1.wuaze.com` and `https://liveuseradmin9x.blogspot.com`.
