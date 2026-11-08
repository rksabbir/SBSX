# বাংলা Deploy Guide — v1.5.42

1. Render-এর Bot service-এ এই সংস্করণের `discord-bot/` folder deploy করুন।
2. Build command `npm install`, Start command `npm start`, Node.js `>=22.12.0` রাখুন।
3. আগের `TOKEN`, Firebase, LiveKit এবং অন্যান্য Environment Variables বজায় রাখুন। এই fix-এর জন্য নতুন secret দরকার নেই।
4. Bot role-এ `View Channel`, `Read Message History`, `Manage Messages`, `Send Messages` এবং Radar pin ব্যবহারের উপযুক্ত permission দিন।
5. একটি test Live শুরু করে Radar pin তৈরি হচ্ছে দেখুন, তারপর Live End করুন। Radar post ও তার “pinned a message to this channel” system notice—দুটিই চলে কি না দেখুন।

নোট: Discord pin করলে মূল Radar post-এর পাশাপাশি আলাদা `CHANNEL_PINNED_MESSAGE` system notification তৈরি হয়। Bot ওই system notification-টি মুছতে চেষ্টা করে, কারণ মূল message delete করলেই এটি সবসময় নিজে থেকে সরে না। Bot শুধু নিজের Live Radar pin notice লক্ষ্য করে; অন্য সদস্যের pin notices মুছবে না। Discord permission বা API বাধা দিলে Render logs-এ failure দেখা যাবে।

এই ZIP local tests-এ যাচাই করা হয়েছে; বাস্তব Discord server-এ deploy করা হয়নি।
