# বাংলা Deploy Guide — RKBACKLES v1.5.44

## 1. Discord Bot deploy

1. Render-এর existing Bot service-এ এই ZIP থেকে `discord-bot/` folder-এর content deploy করুন। Build command `npm install`, Start command `npm start`, Node.js `>=22.12.0`।
2. আগের environment variables (`TOKEN`, Firebase service account/config, LiveKit secrets, `ADMIN_PANEL_ORIGINS`, `LIVE_STUDIO_PUBLIC_BASE_URL` ইত্যাদি) বজায় রাখুন। `LIVE_STREAM_RADAR_TEXT_CHANNELS` না দিলেও default `true`; `false` করলে Radar text/announcement channel-এ post করবে না।
3. Bot role-কে `View Channel`, `Send Messages`, `Read Message History`, এবং permission overwrite বদলাতে প্রয়োজনীয় channel permission দিন। Existing bot pins সরাতে ও pin notice delete করতে `Manage Messages` লাগবে। Role hierarchy-তে Bot role-কে যেসব role/channel overwrite manage করতে হবে, তাদের ওপরে রাখুন।
4. Live শুরুতে Bot সাধারণ text/announcement channel lock করার আগের `Send Messages` states Firebase-এ save করে; save ব্যর্থ হলে lock এড়ায়। Live শেষে restore attempt চলে। Restore failure হলে Bot logs ও `runtime/liveStreamRadarChannelLocks` দেখতে হবে।

## 2. আচরণ যাচাই

1. Test Live চালু করুন। Ticket/support channel বাদে সাধারণ text/announcement channel-এ `Send Messages` বন্ধ হয়েছে কি না যাচাই করুন। Bot-এর নিজের Live Radar message পাঠানো থাকবে, কিন্তু pin হবে না।
2. Live শুরুতে আগে থেকে pinned থাকা bot-authored messages unpin করা হবে। Live চলাকালে কোনো bot-authored message আবার pin হলে Bot `channelPinsUpdate` দেখে unpin করার চেষ্টা করবে। Ticket chat lock হবে না; তবে pinned bot messages ticket channel থেকেও সরানো হবে।
3. Live End করুন। আগের `Send Messages` permission states ফিরে এসেছে কি না যাচাই করুন।
4. কোনো role/member-এ explicit `Send Messages: Allow` overwrite থাকলেও Live চলাকালে deny করা হয়; আগের state restore করার জন্য Firebase snapshot ব্যবহৃত হয়।

## 3. Firebase ও Admin Panel

1. Existing Firebase rules-এ আগের v1.5.43-এর `firebase/database.rules.json` প্রযোজ্য—নতুন rule change প্রয়োজন নেই, যদি আপনার project ইতিমধ্যে সেই rules ব্যবহার করে।
2. Closed Ticket Archive feature-এর জন্য আগের deployment process-ই অনুসরণ করুন। Bot deploy হওয়ার পর বন্ধ করা ticket-এর archive save হলে Admin Panel-এ দেখা যাবে। পুরোনো closed tickets auto-import হবে না।

## সীমাবদ্ধতা

- Discord Administrator permission ও Server Owner channel overwrite bypass করতে পারেন। আপনি জানিয়েছেন কোনো role-এ Administrator নেই, তাই regular roles/members restriction-এর আওতায় থাকার কথা।
- Ticket detection channel name, category, topic এবং private-ticket permission pattern দেখে। custom ticket category/name থাকলে test করুন যাতে ভুল করে ticket lock না হয়।
- এই release local automated tests-এ যাচাই করা হয়েছে; বাস্তব Discord server, Firebase project বা hosting-এ deploy/verify করা হয়নি।
