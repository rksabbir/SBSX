# RKBACKLES v1.5.28 — Deploy নির্দেশিকা (বাংলা)

## 1. Render Root Directory
যদি পুরো `payment-reader-system` project একই repository-তে রাখো, Render service-এর Root Directory হবে `payment-reader-system/discord-bot` (অথবা GitHub-এ bot folder সরাসরি root-এ merge করলে `discord-bot`).

- Build Command: `npm install`
- Start Command: `npm start` (`node index.js` চালায়)
- Node.js: `>=22.12.0`

এটি আলাদা `discord-bot/` folder layout; `index.js`, helper JavaScript, `package.json` এবং `public/` একই bot folder-এ থাকতে হবে.

## 2. Render Environment variables
`discord-bot/.env.example` দেখো। Render → Environment-এ প্রয়োজনমতো যোগ করো:

- `TOKEN`: Discord Bot token (private)
- `FIREBASE_CONFIG` এবং `FIREBASE_DB_URL`: বিদ্যমান Bot configuration
- `ADMIN_PANEL_ORIGINS`: Blogger Admin Panel-এর exact HTTPS origin, comma-separated
- `LIVEKIT_URL`: `wss://sabbir-ylq7x559.livekit.cloud` (তোমার দেওয়া LiveKit project URL)
- `LIVEKIT_API_KEY`: LiveKit Project → Settings/API Keys থেকে একই project-এর API key
- `LIVEKIT_API_SECRET`: একই project-এর API secret
- `PUBLIC_BASE_URL`: `https://sbsx.onrender.com` অথবা তোমার বর্তমান Render service URL
- `LIVE_STUDIO_MAX_PARTICIPANTS=20`
- `LIVE_STUDIO_MAX_DURATION_MS=14400000`
- `LIVE_STUDIO_INVITE_TTL_MS=14400000`
- `LIVE_STUDIO_MAX_INVITE_USES=10000`
- `LIVE_STREAM_RADAR_PIN_ALL_TEXT_CHANNELS=true`

**কোনো secret ZIP/GitHub/Blogger HTML/chat-এ দেবে না.** `LIVEKIT_API_KEY` ও `LIVEKIT_API_SECRET` LiveKit Project-এর একই credentials হতে হবে.

## 3. Discord permissions
Bot-কে target server-এ থাকতে হবে। Radar pinned message-এর জন্য Bot-এর প্রতিটি লক্ষ্য text channel-এ `View Channel`, `Send Messages`, `Read Message History`, `Manage Messages`/Pin Messages permissions লাগবে। যেখানে permission নেই, সেখানে pin/announcement সম্ভব হবে না; log-এ warning দেখবে.

`LIVE_STREAM_RADAR_PIN_ALL_TEXT_CHANNELS=false` দিলে all-channel pinning বন্ধ করা যাবে.

## 4. Admin Panel publish
`admin-panel/blogger-admin-panel.html`-এর content Blogger-এ publish করো. Admin Panel API Base URL হিসেবে শুধু Render origin দাও, যেমন `https://sbsx.onrender.com`—কোনো path বা `/api` suffix দিও না. Firebase Auth-এর Authorized domains-এ তোমার Blogger domain থাকতে হবে.

## 5. Live Studio চালানো
1. Admin Panel → `LIVE STREAM RADAR` খুলে `Start Live Studio` চাপো.
2. Generated invite link কপি করে Discord-এর প্রয়োজনীয় text channel-এ পাঠাও. Bot `LIVE STREAM RADAR` message eligible text channels-এ pin/update করবে.
3. Invite link-এ ঢুকলেই member auto-join করবে; Discord role/OAuth verification বা agreement checkbox নেই.
4. কথা বলতে `Enable Mic` চাপতে হবে; screen/game share করতে `Share Screen` চাপো এবং browser picker-এ window/tab নির্বাচন করো. Quality select-এ 480p/720p/1080p/1440p/2160p থেকে পরের share-এর capture quality বেছে নাও. Fullscreen stage button ব্যবহার করো.
5. Admin Panel থেকে Mute, Unmute, Mute Everyone, Unmute Everyone, Kick অথবা End Studio করা যায়.

## 6. Verify
Deploy-এর পরে `https://YOUR-RENDER-SERVICE.onrender.com/api/live-studio/route-health` খোলো. `pages.liveRoom` ও `pages.discordShareStudio` true এবং `configured` true দেখতে হবে. এরপর Bot host logs-এ `LIVE STREAM RADAR refresh failed` বা `Radar post denied` error আছে কি না দেখো.

## সীমা
এই room LiveKit browser room—Discord-এর native Go Live নয়। Browser security-এর কারণে mic ও screen capture user-কে স্পষ্টভাবে button চাপতে এবং browser permission দিতে হবে. Invite link bearer access: link পেলে যে কেউ voice room-এ ঢুকে mic/screen publish করতে পারবে. Admin controls invite guest-এর কাছে খোলা নয়. এই package তৈরি/টেস্ট হয়েছে, কিন্তু GitHub/Render-এ deploy করা হয়নি.

## v1.5.32 Firebase Security Rules deployment

1. Firebase Console → Realtime Database → Rules খুলে current rules export/copy করে নিরাপদে ব্যাকআপ রাখুন।
2. `firebase/database.rules.json` deployable rules; আগে দেখে নিশ্চিত করুন অন্য app বা legacy client-এর প্রয়োজনীয় path বাদ পড়ছে না।
3. Project root-এ Firebase CLI ব্যবহার করলে চালান: `firebase deploy --only database --project rkbackles`। CLI ব্যবহার না করলে একই JSON Realtime Database → Rules editor-এ paste করে Publish করতে পারেন।
4. Admin Panel-এ sign in, Bot heartbeat, Reader device heartbeat, Transactions এবং Live Stream Radar পরীক্ষা করুন। Incognito/logged-out browser থেকে `/transactions.json` খুললে data নয়, permission denied আসা উচিত।
5. Tests: `cd discord-bot && npm test && npm run security:check`। Static tests deployment test-এর বিকল্প নয়।

**সতর্কতা:** rules প্রকাশ করলে live database access policy বদলাবে। অন্য app-এর legitimate paths থাকলে merge না করে পুরো rules replace করবেন না।

