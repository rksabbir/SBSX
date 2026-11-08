# RKBACKLES v1.5.47 — Changelog

## নতুন: Community Automation Center
- Smart onboarding: configurable welcome DM এবং safe auto-role assignment.
- Self-service roles: Admin allowlist-এ Role ID/label/description যোগ করলে User `!roles` দিয়ে পছন্দের role বেছে নিতে পারে; Bot hierarchy, managed role, `Administrator` role ও `Manage Roles` যাচাই করে।
- FAQ assistant: configured FAQ entries থেকে local match; optional OpenAI Responses API fallback approved knowledge base-এ সীমাবদ্ধ।
- Ticket/category guidance: `!tickethelp`-এ configured keyword overlap অনুযায়ী সবচেয়ে কাছের route সাজেস্ট হয়; স্বয়ংক্রিয়ভাবে ticket খোলে বা বন্ধ করে না।
- AI automation builder: Admin-এর request থেকে সর্বোচ্চ ৩টি plain-text keyword-reply rule-এর preview তৈরি; একই authenticated Admin approval দিলে তবেই save হয়।
- Suggestions + reactions (`!suggest`) with Admin Panel status workflow (Pending/Approved/Rejected/Completed) mirrored to the Discord embed when available; Admin poll (`!poll`), event reminders, opt-in reminders (`!notify on|off`), member profile/rank/leaderboard.
- Community analytics, anti-raid join-spike alert এবং bot/AI operation failure alerts.
- Daily metric write buffer, config limits, cooldowns, no-mention replies, admin audit entries এবং event reminder duplicate guards.

## আগের feature অক্ষত
- Live Stream Radar: Radar message pin না করা, ticket channels বাদ দিয়ে eligible text channels lock/unlock, startup session recovery, bot pin cleanup.
- Closed-ticket transcript backup + Admin Panel chat viewer; backup ব্যর্থ হলে ticket channel delete না করা.
- AI role/channel permission planning, explicit Admin approval, permission backup/revert.
- Existing payment, checkout security, Reader/C++ account/session, coupons, orders, transcript, XP/leveling, weekly report, voice statistics and existing Admin Panel controls.

## গুরুত্বপূর্ণ সীমাবদ্ধতা
- AI feature-এর জন্য private Bot host-এ OpenAI API key এবং quota প্রয়োজন। API unavailable হলে AI-only fallback চলবে না; exact/local FAQ ও non-AI automation চলতে পারে।
- FAQ feature control default-এ Off; Admin Panel → Controls থেকে enable করতে হবে।
- Event reminders Bot online থাকা অবস্থায় process করে; delivery marker Firebase-এ থাকে যাতে restart-এ duplicate কমে। Bot সম্পূর্ণ offline থাকলে নির্ধারিত সময়ে Discord message পাঠানো যাবে না।
- Anti-raid system alert-only—কাউকে স্বয়ংক্রিয়ভাবে kick/ban/timeout করে না।
- Live Discord/Firebase/OpenAI deployment test করা হয়নি; included checks are local automated tests and syntax/rules/package checks.
