# বাংলা Deploy Guide — RKBACKLES v1.5.43

## 1. Discord Bot deploy

1. Render-এর বিদ্যমান Bot service-এ ZIP থেকে `discord-bot/` folder-এর content deploy করুন। Build command `npm install`, Start command `npm start`, Node.js `>=22.12.0` ব্যবহার করুন।
2. আগের Environment Variables (`TOKEN`, Firebase service account/config, LiveKit secrets, `ADMIN_PANEL_ORIGINS`, `LIVE_STUDIO_PUBLIC_BASE_URL` ইত্যাদি) অপরিবর্তিত রাখুন। নতুন `LIVE_STREAM_RADAR_TEXT_CHANNELS` variable না দিলেও default `true`; `false` করলে Radar text/announcement channel-এ post করবে না।
3. Bot role-এ অন্তত `View Channel`, `Send Messages`, `Read Message History`, `Manage Channels`/`Manage Roles` দিন। পুরোনো pin cleanup-এর জন্য `Manage Messages` দরকার হতে পারে। Bot role-এর position অবশ্যই সেই role-গুলোর ওপরে রাখুন যাদের channel overwrite পরিবর্তন করতে হবে।
4. Discord Administrator permission ও Server Owner সব channel overwrite bypass করতে পারেন। এই permission রেখে তাদের chat-ও lock করা সম্ভব নয়; normal members/roles-এ restriction প্রযোজ্য।

## 2. Firebase Rules deploy

1. Firebase Console → Realtime Database → Rules খুলুন।
2. ZIP-এর `firebase/database.rules.json`-এর পূর্ণ rules object deploy করুন। শুধু `ticketTranscriptIndex` ও `ticketTranscripts` child rule paste করবেন না; project-এর অন্যান্য rule-ও অক্ষুণ্ণ রাখতে হবে।
3. `adminUids/<আপনার Firebase Auth UID>` এর value `true` আছে কি না নিশ্চিত করুন। Archive list ও chat কেবল অনুমোদিত Admin UID-র জন্য read-enabled। Bot Firebase Admin SDK দিয়ে archive লিখে; Admin Panel client write করতে পারে না।

## 3. Admin Panel publish

1. ZIP থেকে `admin-panel/blogger-admin-panel.html` সম্পূর্ণ ফাইলটি Blogger/আপনার admin hosting-এ প্রকাশ করুন। চাইলে standalone `RKBACKLES_Admin_Panel_V6_Live_Stream_Radar_v1.5.43.html` ব্যবহার করুন।
2. Firebase Authentication → Settings → Authorized domains-এ আপনার hosting domain আছে কি না যাচাই করুন।
3. Admin login করে **Closed Ticket Archive**-এ যান। v1.5.43 Bot deploy হওয়ার পরে Close করা ticket সফলভাবে archive হলে সেটি এখানে দেখাবে।

## 4. পরীক্ষা

1. Test Live চালু করে সাধারণ text channel-এ সদস্যের `Send Messages` বন্ধ হয়েছে কি না এবং ticket channel খোলা আছে কি না দেখুন।
2. Live End করুন; সাধারণ channel-এর আগের permission state ফিরে এসেছে কি না দেখুন। Bot logs-এ restore failure থাকলে permission/hierarchy ঠিক করুন।
3. একটি test ticket close করুন; archive save হলে channel ৫ সেকেন্ড পরে delete হবে এবং Admin Panel archive list-এ chat দেখা যাবে। Firebase archive ব্যর্থ হলে Bot channel delete করবে না।
4. Radar message pin হবে না। পুরোনো pin ও তার system notice cleanup-এর জন্য Bot-কে প্রয়োজনীয় permission দিন।

## গুরুত্বপূর্ণ

- এই ZIP-এর tests local environment-এ চালানো হয়েছে; বাস্তব Discord server, Firebase project বা hosting-এ deploy/verify করা হয়নি।
- পুরোনো closed ticket HTML transcript স্বয়ংক্রিয়ভাবে Firebase archive-এ import হয় না।
- Discord attachment URL সাময়িক হতে পারে; গুরুত্বপূর্ণ ফাইল হলে আলাদা permanent storage বিবেচনা করুন।
