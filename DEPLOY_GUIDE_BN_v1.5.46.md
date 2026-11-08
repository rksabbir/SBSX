# RKBACKLES v1.5.46 — Deploy Guide (বাংলা)

## 1. কোন ফাইল deploy করবে
- Discord Bot: `discord-bot/`-এর সম্পূর্ণ folder deploy করুন; `role-permissions.js` নতুন ফাইল, এটি বাদ দেবেন না।
- Admin Panel: `admin-panel/blogger-admin-panel.html`-এর v1.5.46 HTML ফাইলটি আপনার বর্তমান Admin Panel-এর জায়গায় দিন।
- আগের Firebase Rules সাধারণত এই feature-এর জন্য বদলাতে হয় না—সব permission-plan API Bot-এর মাধ্যমে authenticated Firebase admin UID যাচাই করে।

## 2. Bot host environment variables
Render বা তোমার Bot hosting service-এর Environment Variables-এ এই দুইটি যোগ করো:

```text
OPENAI_API_KEY=তোমার_private_OpenAI_API_key
OPENAI_ROLE_PERMISSIONS_MODEL=gpt-5.4-mini
```

`OPENAI_API_KEY` শুধু private Bot host-এ থাকবে। এটি Admin Panel HTML, Blogger theme, public Firebase config, Discord message বা screenshot-এ কখনো বসাবে না। এরপর Bot redeploy/restart করো। Provider API key/quota সমস্যা থাকলে AI plan তৈরি হবে না এবং কোনো Discord permission বদলাবে না।

আগের environment variables (`TOKEN`, Firebase config, `ADMIN_PANEL_ORIGINS`, `PORT`, LiveKit values) আগের মতোই রাখতে হবে। `ADMIN_PANEL_ORIGINS`-এ তোমার Admin Panel-এর exact HTTPS origin থাকতে হবে।

## 3. Discord Bot permissions
- Bot-এর server-level permission-এ `Manage Roles` থাকতে হবে, অথবা `Administrator` থাকতে পারে।
- নির্দিষ্ট channel-এও Bot-এর effective permission দিয়ে overwrite edit করা সম্ভব হতে হবে।
- Discord server-এ Bot-এর role remove/disable করা থাকলে বা Bot channel-এ permission হারালে Apply fail করবে।
- Role-এ আগে থেকেই `Administrator` থাকলে tool সেই role-এ change করতে দেবে না; `Administrator` channel overwrite অমান্য করে।

## 4. Admin Panel ব্যবহার
1. Admin Panel-এ sign in করো (Firebase `adminUids/{তোমার_UID} = true` হতে হবে)।
2. `AI Role Permissions` section খোলো।
3. Role selector-এ role name ও ID দেখে একটি role বেছে নাও। `@everyone`-ও channel-specific overwrite-এর জন্য বেছে নেওয়া যায়। Integration-managed role এবং Administrator role ব্যবহার করা যাবে না।
4. Channel selector-এ channel name ও ID বেছে নাও। Text, announcement, forum/media, voice/stage এবং category supported। Category-তে overwrite বদলালে synced child channels-এ প্রভাব পড়তে পারে।
5. Goal-এ তোমার নিয়ম পরিষ্কার করে লেখো, যেমন: “Support role can view and reply, read history, attach files; cannot mention everyone or manage messages.”
6. `Generate AI Plan` চাপো। AI-এর `Allow`, `Deny`, `Keep` ও কারণগুলো review করো। `Keep` মানে পুরোনো overwrite অপরিবর্তিত থাকবে।
7. Proposal ঠিক থাকলে review checkbox টিক দিয়ে `Apply Approved Plan` চাপো। Bot প্রথমে আগের overwrite Firebase-এ backup করবে, তারপর শুধু প্রস্তাবের allow/deny পরিবর্তনগুলো apply করবে।
8. `Permission Backups & Revert` থেকে কোনো active backup-এর `Revert` চাপলে সেই plan apply করার আগের role overwrite ফিরবে।

## 5. Safety/limits
- AI proposal auto-apply হয় না; authorized admin-এর explicit approval বাধ্যতামূলক।
- AI planner শুধু allowlisted channel-level permissions নিয়ে কাজ করে; guild-wide `Administrator`, `Manage Roles`, `Manage Guild`, `Manage Webhooks` দেওয়া যায় না।
- `@everyone`-এ পরিবর্তন করলে তা ওই নির্বাচিত channel overwrite-এ সীমাবদ্ধ। Category overwrite synced child channels-এ inherit হতে পারে।
- Backup save করতে না পারলে Bot Discord permission বদলাবে না। AI plan Bot restart হলে expire হয়; নতুন plan তৈরি করতে হবে। Saved backups Firebase-এ থাকে।
- Revert আগের role overwrite restore করে। অন্য admin পরে একই role/channel overwrite-এ আলাদা change করলে Revert করার আগে সেটি যাচাই করো, কারণ Revert পুরোনো snapshot ফিরিয়ে দেয়।

## 6. Troubleshooting
- `AI KEY REQUIRED`: host-এ `OPENAI_API_KEY` সেট করে Bot redeploy/restart করো; এরপর catalog Refresh করো।
- `AI provider error`: key বৈধ কিনা, configured model availability ও provider quota দেখো। Secret key কোনো frontend file-এ কপি কোরো না।
- `Manage Roles missing`: Bot-এর server role এবং target channel-এ effective `Manage Roles` অনুমতি পরীক্ষা করো।
- `Administrator role cannot be restricted`: এই role-এর global Administrator permission সরানো/পর্যালোচনা Discord Server Settings → Roles-এ করতে হবে; channel overwrite দিয়ে Administrator সীমাবদ্ধ হয় না।
- Admin Panel API connection failed: `ADMIN_API_BASE_URL`/C++ Accounts section-এ saved Bot API HTTPS URL ঠিক আছে কি না এবং `ADMIN_PANEL_ORIGINS` allowlist পরীক্ষা করো।

## 7. Validation
Release-এর local automated test suite: 59 passed, 0 failed. Real Discord server এবং OpenAI key-সহ live integration deploy environment-এ আলাদাভাবে পরীক্ষা করতে হবে।
