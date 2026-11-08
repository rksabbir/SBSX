# RKBACKLES v1.5.46 — Changelog (বাংলা)

## নতুন: AI Role Permissions
- Admin Panel-এ `AI Role Permissions` section যোগ করা হয়েছে। Role name + role ID এবং Discord channel name + channel ID দেখা যায়।
- Admin বাংলায়/ইংরেজিতে natural-language goal লিখে AI-কে channel-level permission plan তৈরি করতে বলতে পারবেন।
- AI plan সরাসরি apply হয় না। আগে `Allow`, `Deny`, `Keep` এবং কারণ দেখায়; authorized Firebase admin review করে Apply চাপলে তবেই Discord overwrite edit হয়।
- `Administrator`, `Manage Roles`, `Manage Guild`, `Manage Webhooks`-এর মতো guild-wide privilege AI planner থেকে grant করা যায় না। আগে থেকেই Administrator থাকা role channel overwrite দিয়ে সীমাবদ্ধ করা যায় না—সেই role reject করা হয়।
- `@everyone` role-সহ নির্দিষ্ট role-এর channel overwrite প্রয়োগ করা যায়; global role permission বদলায় না।
- Apply করার আগে বর্তমান target role-এর permission overwrite Firebase-এ backup হয়। Admin Panel থেকে backup Revert করা যায়। Backup save ব্যর্থ হলে Discord permission পরিবর্তন করা হয় না।
- সব role-permission endpoint Firebase ID token যাচাই করে এবং `adminUids/{uid} = true` প্রয়োজন। Rate limit ও audit log যুক্ত।
- OpenAI API key শুধুমাত্র private Bot hosting environment-এ `OPENAI_API_KEY` হিসেবে রাখতে হবে। Browser/HTML/Firebase public config-এ key রাখা যাবে না।

## আগের ফিচারগুলো বজায় আছে
- Live চলাকালে ticket/support channel বাদে eligible text channel lock এবং Live শেষে আগের permission restore।
- Live Radar message pin করা হয় না; Bot pin cleanup handler সক্রিয় থাকে।
- Closed Ticket Archive এবং restart-recoverable Live Studio অপরিবর্তিত রাখা হয়েছে।

## গুরুত্বপূর্ণ setup
- Bot-এর Guild ও target channel-এ `Manage Roles` বা `Administrator` permission দরকার।
- hosting environment-এ `OPENAI_API_KEY` এবং প্রয়োজন হলে `OPENAI_ROLE_PERMISSIONS_MODEL` সেট করে Bot redeploy/restart করতে হবে।
