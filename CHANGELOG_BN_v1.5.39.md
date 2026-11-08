# RKBACKLES v1.5.39 — বাংলা পরিবর্তন নোট

## এই সংস্করণে
- Payment bypass hardening: account credentials তৈরি করার আগে Bot Firebase-এর transaction evidence, verified source, transaction owner, paid total এবং checkout owner মিলিয়ে দেখে। শুধু Buy/splash/button flow দিয়ে account তৈরি করা যাবে না।
- Full-value coupon checkout: coupon balance atomicভাবে consume না হলে free checkout session অনুমোদিত হবে না; সফল consumption-এর server-side proof রাখতে হবে।
- Offline payment: approved staff request, reviewer এবং matching checkout যাচাই করা হয়।
- Race protection: payment validation-এর পর session price/proof বদলে গেলে account-creation claim বন্ধ হয়।
- Ticket/report/customer এবং membership order channel-কে যে panel channel থেকে flow শুরু হয়েছে তার Discord Category-র নিচে বানানো হয় (যদি source channel একটি category-র অন্তর্গত হয়)।
- `!ticket`, `!report`, `!customer`, `!setup`, `!orderguide` এবং `!onetime key` আবার চালালে আগের Bot-owned matching panel message পরিষ্কার করে নতুনটি পাঠায়, duplicate panel জমতে দেয় না।
- Live Studio, Blogger Live Status, Admin Panel theme ও আগের transaction/reader/account ফিচার অপরিবর্তিত রেখেছে।

## Deploy
1. Render-এর Bot service-এ এই ZIP-এর `payment-reader-system/discord-bot` কোড deploy করুন।
2. আগের Environment Variables (`TOKEN`, `FIREBASE_CONFIG`, `FIREBASE_DB_URL`, Reader IDs, LiveKit keys, allowed origins) রাখুন।
3. Build command: `npm install`; Start command: `npm start`; Node `>=22.12.0`।
4. Deploy শেষে logs-এ startup errors নেই কি না দেখুন এবং test checkout চালান।

## নোট
এটি source-code/test release, লাইভ Discord/Render/Firebase-এ deploy করা হয়নি। Payment Reader evidence, staff approval ও Firebase rules বাস্তব server-এ সঠিকভাবে configured থাকতে হবে।
