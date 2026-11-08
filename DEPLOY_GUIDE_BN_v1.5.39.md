# Deploy Guide — v1.5.39

## Discord Bot / Render
- Repository Root Directory: `payment-reader-system/discord-bot` (যদি repository root-এর ভেতরে ওই folder থাকে)।
- Build Command: `npm install`
- Start Command: `npm start`
- Node.js: `>=22.12.0`
- `TOKEN`, `FIREBASE_CONFIG`, `FIREBASE_DB_URL`, `PAYMENT_READER_UIDS`, `BKASH_PAYMENT_NUMBER`, `NAGAD_PAYMENT_NUMBER`, LiveKit এবং `ADMIN_PANEL_ORIGINS` Environment Variables অপরিবর্তিত রাখুন।
- Firebase Admin service account দিয়ে `pending_payments` ও `transactions` পড়ার/লেখার permission থাকতে হবে। Firebase Database Rules যেন public client-কে এই দুইটি node-এ write করতে না দেয়।

## Ticket categories
Ticket/report/customer/order flow যে Discord channel থেকে শুরু হয়, সেই channel যদি একটি Discord Category-র অধীনে থাকে তাহলে নতুন private channel-টি একই Category-র নিচে তৈরি হবে। Source channel category-র বাইরে হলে ticket root level-এ তৈরি হবে। Bot-এর `Manage Channels` permission থাকা জরুরি।

## Panel commands
`!ticket`, `!report`, `!customer`, `!setup`, `!orderguide` এবং `!onetime key` পুনরায় চালালে Bot নিজের আগের matching panel message delete করে প্রতিস্থাপন করবে। Bot আগের message delete করতে না পারলে একটি পুরোনো panel edit করে নতুন panel বানায় এবং অন্য leftover panel disable করার চেষ্টা করে। Bot-কে View Channel, Send Messages ও Read Message History permission দিন।

## Security test
Account credentials তৈরি করার আগে Bot transaction IDs-এর verified status, approved source, used status, buyer ownership এবং amount sum যাচাই করে। Coupon দিয়ে 0 BDT checkout কেবল পূর্ণ discount consume সফল হলে অনুমোদিত। Offline checkout কেবল matching staff-approved request থাকলে অনুমোদিত।

## Important
এই ZIP তৈরি হয়েছে ও local test চালানো হয়েছে; Render, Discord, Firebase বা Payment Reader production-এ deploy/transaction test করা হয়নি। প্রথমে staging/test payment transaction দিয়ে পরীক্ষা করুন।
