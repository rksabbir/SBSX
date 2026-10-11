# RKBACKLES v1.5.23 — Main Bot-এ Discord Share Preview যুক্ত

এই release-এ মূল `index.js`-এর `/discord-share-studio` route, নতুন `public/discord-share-studio.html` এবং helper/test file একসঙ্গে আছে। পুরোনো Live Studio/voice/admin modules রাখা হয়েছে।

## Render / GitHub
- Render service root যদি repo root হয় এবং Start Command `node index.js` হয়, তাহলে **RKBACKLES_Main_Bot_Integrated_v1.5.23.zip**-এর root files repo root-এ merge করুন।
- পুরো project ব্যবহার করলে `discord-bot/` folder-এর contents deploy করুন এবং Render root directory/Start Command সেই অনুযায়ী সেট করুন।
- Build Command: `npm install`; Start Command: `node index.js` বা `npm start`। `package-lock.json` sync না থাকলে `npm ci` ব্যবহার করবেন না।
- `.env.example` reference মাত্র। API keys, Discord token এবং LiveKit secret কেবল Render private environment-এ রাখুন।
- Updated `admin-panel/blogger-admin-panel.html`-এর content Blogger-এ publish করুন।

## Discord-এ share
Admin Panel থেকে `Open Screen Share Preview` খুলুন এবং browser permission দিয়ে একটি app/window বেছে নিন। Discord Desktop-এ একই Voice Channel-এ নিজের সাধারণ account দিয়ে ওই preview window Share Screen করে `Go Live` চাপুন। Media capture page থেকে server-এ upload হয় না। শেষ Discord Go Live action manual; Bot API দিয়ে তা automatic করানো যায় না।

## যাচাইয়ের সীমা
Local syntax/unit tests পাস মানে production deploy বা Discord/Render end-to-end stream পরীক্ষা হয়েছে—এমন নয়।
