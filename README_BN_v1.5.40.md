# RKBACKLES Payment Reader + Admin Panel + Live Studio v1.5.41

## Live Room on Blogger root
- The canonical live address is `https://liveuseradmin9x.blogspot.com/`.
- Generated invite URLs use `https://liveuseradmin9x.blogspot.com/?invite=...`; no `/live-room.html` URL path is used.
- Import `RKBACKLES_Blogger_Live_Room_Theme_v1.5.41.xml` via Blogger Dashboard → Theme → Restore/Upload. The `discord-bot/public/live-room.html` remains the source page used to generate the theme.
- The Blogger root theme accepts `?invite=...` and host join data in the URL hash.

## Render settings
- Root Directory: `payment-reader-system/discord-bot` (or `discord-bot` if that is the repository root).
- Build: `npm install`; Start: `npm start`; Node.js 22.12+.
- Set `LIVE_STUDIO_PUBLIC_BASE_URL=https://liveuseradmin9x.blogspot.com` and `ADMIN_PANEL_DEFAULT_ORIGIN=https://admin-9x7v1.wuaze.com`.
- Keep both origins in `ADMIN_PANEL_ORIGINS`: `https://admin-9x7v1.wuaze.com,https://liveuseradmin9x.blogspot.com`.
- Keep Discord/Firebase/LiveKit secrets only in Render Environment Variables.

## Scope
This release changes the public live-room location from a separate `/live-room.html` path to the Blogger root theme. Existing payment, order, account, reader, ticket and Live Studio code is otherwise preserved.
