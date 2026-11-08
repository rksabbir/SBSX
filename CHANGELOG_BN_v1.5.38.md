# Changelog v1.5.38 — Admin Panel Live V6 Upgrade

- Added LiveKit server SDK dependency (`livekit-server-sdk` v2.x).
- Added `live-studio-core.js` and `live-studio-server.js` routes for start, status, invite, redeem, end, LiveKit moderation, and Discord voice moderation.
- Admin Panel now includes LIVE STREAM RADAR, custom duration, countdown, all cached Discord voice/stage channels, live participants, screen share count, pin/voice actions, status and activity timeline.
- Invite links generated at `https://admin-9x7v1.wuaze.com/live-room.html`.
- Added static `public/live-room.html` that auto-joins invite, offers mic, screen share, HD presets, fullscreen and invalid-link return flow.
- Uses numeric TrackSource values to avoid enum-to-string errors.
- Live text messages are pinned/edited in eligible channels and Bot-owned live messages are removed when the session ends; invites are revoked and room deleted.
- Moved Express listener startup after route registration to avoid new endpoints being served before the feature routes were attached.
- Added 15 focused Live Studio/Radar tests; plus 5 existing Reader session tests. `npm test`: 20 passed, 0 failed.

- Added Blogger public live-status widget for `liveuseradmin9x.blogspot.com`; it polls a minimal public Bot API endpoint every 5 seconds, no page reload. Responsive layout supports phones, tablets and PCs.
- Added a read-only `/api/live-studio/public-status` endpoint that exposes only current invite URL and timing; no public Firebase database reads needed.
- CORS environment example now includes the Blogger origin alongside the Admin Panel origin.


## v1.5.38 changes
- Temporarily set the Bot profile activity to `🔴 LIVE NOW · Live Studio`; restore configured presence after end/expiry.
- Fixed stale account editor fields after looking up a different username and separated same-name edits from atomic rename transactions.
- Added separate `username_conflict` / `record_changed` API errors. Existing password remains hidden and unchanged unless a new password is supplied.
- Added a saved light/dark Admin Panel theme toggle and responsive theme styles.
- Improved purchase DM/ticket handoff and visible warning for failed DM delivery.
- Added five regression checks; combined `npm test`: 25 passed, 0 failed.
- Security: the admin UI stays client-side inspectable; no obfuscation can make browser code secret. Server-side credential protection remains required.
