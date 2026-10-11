# RKBACKLES v1.5.27 — Deploy Guide (বাংলা)

## Discord OAuth setup (অবশ্যই করতে হবে)
1. Discord Developer Portal-এ Bot-এর একই Application খুলুন। OAuth2 → Redirects-এ হুবহু এই URL যোগ করুন:
   `https://sbsx.onrender.com/api/live-studio/auth/callback`
2. ওই Application-এর OAuth2 Client ID ও Client Secret ব্যবহার করুন। **Bot Token (`TOKEN`) আর OAuth Client Secret এক জিনিস নয়।**
3. Render → Environment-এ এই variables যোগ করুন:
   - `LIVE_STUDIO_OAUTH_CLIENT_ID` = Discord Application Client ID
   - `LIVE_STUDIO_OAUTH_CLIENT_SECRET` = ওই Application-এর OAuth2 Client Secret
   - `LIVE_STUDIO_OAUTH_REDIRECT_URI` = `https://sbsx.onrender.com/api/live-studio/auth/callback`
   - `LIVEKIT_API_KEY` = LiveKit project API key
   - `LIVEKIT_API_SECRET` = একই LiveKit project API secret
   - `LIVE_STUDIO_ADMIN_USER_IDS` = অতিরিক্ত moderator Discord User ID, comma-separated
   - `LIVE_STUDIO_ADMIN_ROLE_IDS` = moderator Discord Role ID, comma-separated
4. Discord bot-টি target server-এ থাকতে হবে এবং configured guild members/roles fetch করতে পারতে হবে। Server Owner ও `Administrator` permission-ধারীরা স্বয়ংক্রিয়ভাবে moderator। অন্য role/user ID allowlist-এ রাখুন।

OAuth Client Secret ও LiveKit API Secret কখনো Blogger HTML, GitHub public HTML বা chat-এ দেবেন না। শুধু Render private Environment ব্যবহার করুন।

## Root deployment ZIP ব্যবহার করলে
- ZIP extract করে **ZIP-এর ভেতরের contents** Render GitHub service-এর root-এ রাখতে হবে। `index.js`, `package.json`, helpers, `public/` একই root-এ থাকবে।
- Render Root Directory: ফাঁকা/repository root
- Build Command: `npm install`
- Start Command: `node index.js`

## Full project ZIP ব্যবহার করলে
- GitHub repository-র root-এ project structure merge করুন।
- Render Root Directory: `discord-bot`
- Build Command: `npm install`
- Start Command: `npm start`
- `discord-bot/index.js`-এর পাশেই `discord-bot/public/` থাকতে হবে।

## Admin Panel
`admin-panel/blogger-admin-panel.html` (separate HTML link-ও দেওয়া হয়েছে) Blogger-এ আপনার existing Admin Panel page-এর content হিসেবে publish করুন। Panel API Base URL `https://sbsx.onrender.com` হওয়া উচিত।

## Verify after deploy
- Open `https://sbsx.onrender.com/api/live-studio/route-health` → `ready: true`, `pages.liveRoom: true`, `pages.discordShareStudio: true` হওয়া উচিত।
- Live Studio চালু করে participant invite তৈরি করুন।
- অতিথিরা Discord OAuth sign-in করে `Join Live Room` চাপবে; এরপর browser mic permission / screen picker ব্যবহার করবে।
- Moderator account-এ `Room moderation` panel দেখাবে: Mute everyone, Unmute everyone, individual Mute/Unmute, Kick, Create invite, End room।

Live Studio একটি আলাদা LiveKit browser room; native Discord Go Live নয়। এই artifacts তৈরি/test করা হয়েছে, কিন্তু GitHub বা Render-এ নিজে থেকে push/deploy হয়নি।
