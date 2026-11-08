# RKBACKLES v1.5.47 — বাংলা Deploy Guide

## ১) কোন ফাইল কোথায় যাবে

- `RKBACKLES_Admin_Integrated_v1.5.47.zip`: সম্পূর্ণ project; এটিই recommended.
- `RKBACKLES_Discord_Bot_Live_Stream_Radar_v1.5.47.zip`: Bot code + Firebase rules/reference + setup docs.
- `RKBACKLES_Admin_Panel_V6_Live_Stream_Radar_v1.5.47.zip`: Admin Panel HTML ও panel-side files.
- `RKBACKLES_Admin_Panel_V6_Live_Stream_Radar_v1.5.47.html`: একক Admin Panel HTML.

## ২) Bot deploy

1. Integrated ZIP খুলে `discord-bot/` project-এর contents তোমার Bot hosting-এ deploy করো।
2. `discord-bot/package.json`-এর Node requirement হলো `>=22.12.0`; hosting-এ compatible Node ব্যবহার করো।
3. Existing environment variables (Discord token, Firebase database URL/service-account config, guild/configuration values, LiveKit values) অপরিবর্তিত রাখো। `.env.example`-এ সব নতুন optional AI model setting রয়েছে।
4. Community AI features ব্যবহার করতে private Bot host-এ add করো:

```env
OPENAI_API_KEY=YOUR_PRIVATE_OPENAI_API_KEY
OPENAI_ROLE_PERMISSIONS_MODEL=gpt-5.4-mini
OPENAI_FAQ_MODEL=gpt-5.4-mini
OPENAI_AUTOMATION_MODEL=gpt-5.4-mini
```

`OPENAI_API_KEY` কখনও Admin HTML, Blogger theme, Discord message, Git repository বা C++/Android client-এ বসাবে না। Hosting provider-এর secret/environment-variable settings ব্যবহার করো। API key না থাকলে AI fallback/planner unavailable থাকবে; Bot-এর non-AI feature চলতে পারে।

5. Dependencies install এবং local check:

```bash
cd discord-bot
npm install
npm test
npm start
```

Production host সাধারণত `npm start` নিজে চালায়; hosting setup অনুযায়ী command ব্যবহার করো।

## ৩) Admin Panel publish

1. `RKBACKLES_Admin_Panel_V6_Live_Stream_Radar_v1.5.47.html`-এ তোমার Firebase Web SDK public config-টি project convention অনুযায়ী যাচাই করো। Firebase Web API key public client config, কিন্তু service-account secret নয়।
2. Hosting-এর Admin Panel HTML upload/publish করো। পুরোনো deployed HTML cache-এ থাকলে hard refresh/clear cache করো।
3. Bot environment-এর `ADMIN_PANEL_ORIGINS`-এ Admin Panel-এর exact HTTPS origin থাকতে হবে। পরিবর্তন করলে Bot redeploy/restart করো।
4. `firebase/database.rules.json`-এর rules compare করে বর্তমান rules-এ প্রযোজ্য update deploy করো। Rules overwrite করার আগে live rules backup নাও। Ticket archive/runtime read access শুধু Firebase-verified admin UID-দের জন্যই থাকবে।

## ৪) Community Automation Center কনফিগার

Admin Panel login করে **Community Automation** খুলে প্রয়োজনীয় তথ্য save করো।

### Smart onboarding / safe role config
- welcome DM template-এ `{user}` ও `{server}` placeholder ব্যবহার করা যায়।
- Auto-role IDs কমা দিয়ে আলাদা করে লেখো।
- Self-select role JSON উদাহরণ:

```json
[
  {"roleId":"123456789012345678","label":"Game Updates","description":"Gaming update পেতে"},
  {"roleId":"223456789012345678","label":"Music","description":"Music event update"}
]
```

বাস্তব Discord Role ID বসাতে হবে। Bot-এর `Manage Roles` permission এবং role hierarchy প্রয়োজন। Bot Administrator/managed role বা Bot-এর highest role-এর সমান/উপরের role assign/remove করবে না। User `!roles` দিলে configured options থেকে role বেছে নিতে পারবে।

### FAQ / AI knowledge base
FAQ entries JSON উদাহরণ:

```json
[
  {"question":"কীভাবে ticket খুলব?","keywords":["ticket","support","সাপোর্ট"],"answer":"Ticket Panel-এর button থেকে category বেছে নাও.","enabled":true}
]
```

AI knowledge base-এ শুধু প্রকাশ করার অনুমতি আছে এমন server rules, FAQ, process ও policy রাখো। `OPENAI_API_KEY` লাগবে। তারপর **Controls → AI FAQ assistant** চালু করো। AI কোনো FAQ-র নিশ্চিত উত্তর না পেলে user-কে Staff/ticket-এ পাঠাবে।

### Smart ticket routing
Ticket routes JSON উদাহরণ:

```json
[
  {"name":"Billing","keywords":["payment","refund","transaction","পেমেন্ট"],"hint":"Payment support ticket ব্যবহার করো.","supportRoleId":"123456789012345678","enabled":true}
]
```

`!tickethelp <problem>` ব্যবহারকারীর সমস্যার সবচেয়ে কাছের category সাজেস্ট করবে; এটি নিজে ticket খোলে না বা delete করে না।

### Keyword automation builder
- Manual rule-এ keywords, plain-text reply এবং per-user cooldown দাও; অথবা AI Automation Rules Builder-এ goal লিখে Preview করো।
- Preview পরীক্ষা করে **Approve & apply** দিলে rule save হবে।
- Bot replies `allowedMentions` নিষ্ক্রিয় রাখে, তাই reply-এর role/user mention স্বয়ংক্রিয়ভাবে ping করবে না।
- Controls-এ **Keyword automation rules** চালু থাকতে হবে।

### Suggestions, polls, events
- Suggestion channel ID configure করলে `!suggest <idea>` সেই channel-এ vote reactions-সহ যাবে। blank রাখলে command যেই channel-এ দেওয়া হয় সেখানে পাঠানোর চেষ্টা হবে। Admin Panel-এর Recent Suggestions থেকে status Pending/Approved/Rejected/Completed করা যায়; bot Discord embed-এও status mirror করার চেষ্টা করে।
- Admin-only poll: `!poll প্রশ্ন | Option 1 | Option 2`.
- Event-এর title, local date/time, default/override channel, reminder minutes (`60,15,5,0`) save করো। নির্দিষ্ট সময়ে Bot online থাকতে হবে।
- User `!notify on` দিয়ে opt-in এবং `!notify off` দিয়ে reminder ping বন্ধ করতে পারে। `Mention opted-in users` বেছে নিলে সর্বোচ্চ ৫০টি subscriber mention cap প্রয়োগ হয়।

### XP, analytics, alerts
- `!rank`, `!leaderboard`, `!profile` ব্যবহার করা যাবে; আগের XP/level settings থেকে progress হিসাব করা হয়।
- Controls-এ Community Analytics ও Anti-raid Join-spike Alerts চালু রাখো।
- Join-spike detection শুধু alert দেয়, auto-ban/timeout করে না। Alert পাঠাতে Bot-এর configured staff/admin log বা log channel-এ `View Channel`, `Send Messages`, `Embed Links` permission লাগবে।

## ৫) Discord Bot permissions/intents

Bot invite/Developer Portal-এ project-এর existing requirements রাখো; নতুন feature অনুযায়ী অন্তত channel read/send, embed links, add reactions, member join events, message content intent (prefix commands), এবং self-role/auto-role-এর জন্য `Manage Roles` প্রয়োজন হতে পারে। Bot-এর সর্বোচ্চ role target self-service/autore-assigned roles-এর ওপরে রাখো। Manage Roles শুধু প্রয়োজনীয় automation-এর জন্য enable করো।

## ৬) Existing Live & Ticket safety

- Live Radar message pin করে না। Live চলাকালে ticket/support বাদে eligible text/announcement channels-এর Send Messages lock/restore আগের feature থেকে চালু আছে। আগে থেকে explicit `Send Messages: Deny` overwrite-এর জন্য lock target তৈরি হয় না।
- Closed-ticket archive save ব্যর্থ হলে channel delete করা হয় না।
- AI Role Permissions `Preview → Admin approval → Firebase backup → Apply → Audit log → Revert` workflow-এ চলে।

## ৭) পরীক্ষা ও সীমাবদ্ধতা

Release package-এ ৭০টি Node automated test অন্তর্ভুক্ত, test suite local-এ run করা হয়েছে; JS syntax, embedded panel JS, Firebase JSON এবং ZIP integrity আলাদা করে check করা হবে। এগুলো বাস্তব Discord server, Firebase project, role hierarchy, LiveKit বা OpenAI quota-তে end-to-end test নয়। প্রথমে test/staging server-এ deploy করো, ছোট role/channel config দিয়ে যাচাই করো, তারপর production-এ ব্যবহার করো।

Bot সম্পূর্ণ offline থাকলে real-time event reminder/alerts পাঠানো যাবে না; Scheduler Bot process চলার সময় কাজ করে। AI provider quota/key/network error হলে AI feature-এর জন্য configured fallback/alert দেখো।
