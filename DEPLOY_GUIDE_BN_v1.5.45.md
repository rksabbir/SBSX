# বাংলা Deploy Guide — RKBACKLES v1.5.45

## Bot deploy
1. Render-এর Bot service-এ এই ZIP-এর `discord-bot/` content deploy করুন; Build `npm install`, Start `npm start`, Node `>=22.12.0`।
2. আগের environment variables অপরিবর্তিত রাখুন। LiveKit + Firebase Admin credentials configured থাকতে হবে।
3. Bot-এর `View Channel`, `Read Message History`, `Send Messages`, channel permission overwrite edit করার ক্ষমতা এবং pinned messages unpin/delete করতে `Manage Messages` দরকার।
4. Bot online হলে startup recovery Firebase-এর `runtime/liveStreamRadarSession` record এবং LiveKit room মিলিয়ে দেখে। Room এখনও active এবং expiry পেরোয়নি হলে active Live পুনরায় চালু করে channel locks/pin cleanup চালাবে। Session absent/expired হলে saved channel permissions restore হবে।

## Permission আচরণ
- Ticket/support channel lock হবে না।
- সাধারণ eligible text/announcement channel live চলাকালে temporary chat lock হবে।
- যে role/member-এর overwrite-এ আগে থেকেই `Send Messages: Deny` আছে, সেটিকে temporary lock target করা হয় না। Explicit allow যেগুলোর কারণে member send করতে পারত, কেবল সেগুলো temporary deny করা হয় এবং Firebase snapshot থেকে original state ফেরে।
- Snapshot save না হলে channel permission edit করা হবে না।
- Live end বা expired session হলে restore process নিজে থেকে চালু হবে।

## প্রথম deploy note
এই recovery snapshot v1.5.45 থেকে শুরু করা session-এর জন্য। নতুন build deploy করার পর একবার নতুন Live start করুন; এরপর Bot restart হলে session recovery চালু থাকবে।

## পরীক্ষা
Deploy-এর পর একটি test Live চালু করুন, role overrides পরীক্ষা করুন এবং Live চলাকালে Bot restart করে দেখুন recovery কাজ করছে কি না। তারপর Live end করে আগের permissions ফেরত এসেছে কিনা যাচাই করুন।

## সীমাবদ্ধতা
- Discord Server Owner/Administrator permission channel overwrites bypass করে।
- Firebase Admin SDK deploy credential ব্যবহার করে, তাই RTDB client rules-এ `.write: false` থাকলেও server-side Bot writes চলবে। Client access rules পরিবর্তন করার দরকার নেই।
- Local tests বাস্তব Discord/Render/Firebase deployment-এর বিকল্প নয়; live server-এ test করা প্রয়োজন।
