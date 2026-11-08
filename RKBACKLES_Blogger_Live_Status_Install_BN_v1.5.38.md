# Blogger Live Status Widget — সেটআপ গাইড (বাংলা)

## কোন সাইট কী করবে?

- Admin Panel: `https://admin-9x7v1.wuaze.com/`
- Public Live Status: `https://liveuseradmin9x.blogspot.com/`
- Bot API: `https://sbsx.onrender.com` (আপনার Bot অন্য URL-এ থাকলে ফাইলের `API_BASE_URL` পরিবর্তন করুন)

Admin Panel থেকে Live শুরু করলে Blogger widget কয়েক সেকেন্ডের মধ্যে “LIVE NOW”, লাইভে ঢোকার URL এবং countdown দেখাবে। Live শেষ হলে URL সরিয়ে দেবে। পুরো পেজ reload করবে না; প্রতি ৫ সেকেন্ডে status API check করে। মোবাইল, ট্যাবলেট ও PC-র জন্য responsive layout রয়েছে।

## ধাপ ১ — Bot আপডেট করুন

এই প্যাকেজের `discord-bot/` ফোল্ডার/ZIP আপনার Bot-এর deploy source-এ আপডেট করে Render-এ redeploy করুন। Render-এর existing private environment variables (`TOKEN`, `FIREBASE_CONFIG`, `FIREBASE_DB_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` ইত্যাদি) মুছবেন না। নতুন/হালনাগাদ variable:

`ADMIN_PANEL_ORIGINS=https://admin-9x7v1.wuaze.com,https://liveuseradmin9x.blogspot.com`

উভয় origin-এর মধ্যে comma থাকবে, space বা URL path নয়। Save করে Bot redeploy/restart করুন।

## ধাপ ২ — Blogger-এ widget বসান

1. Blogger dashboard-এ `liveuseradmin9x.blogspot.com` নির্বাচন করুন।
2. **Layout → Add a Gadget → HTML/JavaScript** নির্বাচন করুন।
3. এই ফাইল `RKBACKLES_Blogger_Live_Status_Widget_v1.5.38.html`-এর পুরো content কপি করে gadget-এর content box-এ paste করুন। Gadget title ফাঁকা রাখতে পারেন বা `Live` দিতে পারেন।
4. **Save** করুন এবং Layout-এ gadget-টি যেখানে live status দেখাতে চান সেখানে সরান। মোবাইল Layout setting-এ gadget hidden আছে কি না দেখুন।
5. সাইটে গিয়ে live card এবং mobile view পরীক্ষা করুন।

## ধাপ ৩ — পরীক্ষা করুন

1. `https://sbsx.onrender.com/api/live-studio/route-health` খুলুন; Bot live এবং LiveKit config থাকলে `configured: true` দেখাবে।
2. Admin Panel-এ login করে **LIVE STREAM RADAR → Start Live Studio** চাপুন।
3. `https://liveuseradmin9x.blogspot.com/` খুলে ৫–১০ সেকেন্ড অপেক্ষা করুন। Live URL এবং countdown আসার কথা। Join Live চাপলে `admin-9x7v1.wuaze.com/live-room.html?invite=...` খুলবে।
4. Admin Panel থেকে live end করুন; Blogger widget-এ কিছু সেকেন্ডের মধ্যে “এখন লাইভ চলছে না” দেখানোর কথা।

## সাধারণ সমস্যা

- **Connection/CORS issue:** Render-এর `ADMIN_PANEL_ORIGINS`-এ উপরের দুই origin একদম হুবহু আছে কি না এবং Bot redeploy হয়েছে কি না দেখুন।
- **Live shows offline:** Bot source আপডেট/deploy হয়েছে কি না দেখুন। `/api/live-studio/route-health` পরীক্ষা করুন এবং LiveKit key/secret URL সঠিক কি না যাচাই করুন।
- **Join link খুলছে না:** InfinityFree `htdocs/`-এর root-এ `live-room.html` থাকতে হবে এবং Render API URLটি `https://sbsx.onrender.com` হতে হবে, যদি না আপনি অন্য URL ব্যবহার করেন।
- **Widget দেখা যাচ্ছে না:** Gadget save হয়েছে কি না এবং Blogger mobile Layout-এ লুকানো আছে কি না দেখুন।

Widgetটি শুধু public live status ও intentionally public invite URL দেখায়। Firebase Database-এর `runtime` read permission public করবেন না। Live URL যে কেউ পেলে invite expiry/limit অনুযায়ী room-এ join করার চেষ্টা করতে পারে—শুধু যাদের দিতে চান তাদের সঙ্গে URL share করুন।

**নোট:** এই ফাইলগুলো তৈরি ও স্থানীয়ভাবে পরীক্ষা করা হয়েছে; Blogger, Render, InfinityFree বা Discord-এ আপনার অ্যাকাউন্টে সরাসরি deploy করা হয়নি।
