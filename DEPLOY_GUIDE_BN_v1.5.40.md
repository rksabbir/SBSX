# বাংলা Deployment Guide — v1.5.41

## 1) Blogger Live Room theme
1. Blogger Dashboard → Theme → Restore/Upload-এ যান।
2. `RKBACKLES_Blogger_Live_Room_Theme_v1.5.41.xml` upload করুন। Theme পরিবর্তন বর্তমান Blogger theme প্রতিস্থাপন করবে; আগে বর্তমান theme backup নিন।
3. Live Room invite URL হবে `https://liveuseradmin9x.blogspot.com/?invite=INVITE_CODE`। আলাদা `/live-room.html` path নেই। Root link-এ invite ছাড়া গেলে join করা যাবে না—সক্রিয় invite link ব্যবহার করতে হবে।
4. Theme script-এর `BOT_API_BASE_URL` আপনার Bot hosting URL-এর সঙ্গে মিলিয়ে নিন (ডিফল্ট `https://sbsx.onrender.com`)।

## 2) Render Bot Environment
- `LIVE_STUDIO_PUBLIC_BASE_URL=https://liveuseradmin9x.blogspot.com`
- `ADMIN_PANEL_DEFAULT_ORIGIN=https://admin-9x7v1.wuaze.com`
- `ADMIN_PANEL_ORIGINS=https://admin-9x7v1.wuaze.com,https://liveuseradmin9x.blogspot.com`
- Existing `TOKEN`, `FIREBASE_CONFIG`, `FIREBASE_DB_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` values রাখুন।
- Build command: `npm install`; Start command: `npm start`; Node >=22.12.0.
- Save করে Bot redeploy করুন।

## 3) Validate
1. `/api/live-studio/route-health` থেকে configured/ready যাচাই করুন।
2. Admin Panel থেকে Live শুরু করুন।
3. Generated invite যেন `https://liveuseradmin9x.blogspot.com/?invite=...` দিয়ে শুরু হয় নিশ্চিত করুন।
4. Incognito browser-এ invite খুলে mic permission, join, leave এবং expired invite পরীক্ষা করুন।
5. Blogger page থেকে Render API-তে CORS অনুমোদিত কিনা দেখুন।

## Notes
- Theme upload করা হয়নি; এটি আপনাকে Blogger dashboard-এ import করতে হবে।
- Theme apply করলে বিদ্যমান Blogger layout/theme বদলাবে; আগে backup নিন।
- `live-room.html` source file package-এ থাকবে, কিন্তু invite URL-এ সেটি path হিসেবে থাকবে না।
