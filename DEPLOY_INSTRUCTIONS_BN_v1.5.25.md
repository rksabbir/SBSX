# RKBACKLES v1.5.25 — Separate Discord Bot Folder

## Folder structure
- `discord-bot/` — Bot runtime: `index.js`, `package.json`, helper JS, `public/`, `test/`
- `admin-panel/` — Blogger Admin Panel HTML
- `firebase/` — Firebase database rule/config references

## Render configuration
1. এই project structure GitHub `RK` branch-এ রাখো। `discord-bot/`, `admin-panel/`, এবং `firebase/` একই project root-এর sibling হবে।
2. Render service-এর **Root Directory** `discord-bot` সেট করো।
3. Build Command: `npm install`
4. Start Command: `npm start` (runs `node index.js`)
5. আগের প্রয়োজনীয় private environment variables Render-এর Environment-এ রাখো। কোনো secret ZIP/GitHub-এ রেখো না।

## Verify routes
Deploy-এর পর:
`https://YOUR-RENDER-SERVICE.onrender.com/api/live-studio/route-health`

Expected JSON: `version` = `1.5.25`, `ready` = `true`, `pages.liveRoom` = `true`, `pages.discordShareStudio` = `true`.
তারপর `/discord-share-studio` খোলো। Viewer room `/live-room`-এ ঢুকতে valid invite/session লাগতে পারে।

## Admin Panel
`admin-panel/RKBACKLES_Admin_Panel_v1.5.25_ROUTE_FIX.html` অথবা `admin-panel/blogger-admin-panel.html`-এর HTML content Blogger-এ publish করো। API base URL হিসেবে শুধু Render origin দাও, path বা `/api` suffix নয়।

## Important
এই ZIP GitHub বা Render-এ নিজে থেকে deploy হয় না। Syntax ও test pass করা হলেও বাস্তব service-এ route health JSON দেখে নিতে হবে। Discord-এর native screen share-এর শেষ ধাপ Discord Desktop-এ user-কে `Share Screen → Preview window → Go Live` চাপতে হয়।
