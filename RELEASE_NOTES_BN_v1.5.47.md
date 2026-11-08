# Release Notes — v1.5.47

এই release-এ Admin Panel-এর Community Automation Center যোগ করা হয়েছে। Onboarding, optional self-roles, FAQ, ticket guidance, suggestion voting ও Pending/Approved/Rejected/Completed status workflow, AI-approved keyword reply rules, event reminders, XP/profile commands, community analytics এবং staff alerts এক জায়গা থেকে কনফিগার করা যাবে।

নতুন user-facing commands:
- `!help`
- `!faq <question>`
- `!tickethelp <problem>`
- `!suggest <idea>`
- `!rank`, `!leaderboard`, `!profile`
- `!notify on` / `!notify off`
- `!roles`
- Admin-only `!poll Question | Option 1 | Option 2`

AI-generated keyword rule সরাসরি apply হয় না: proposal preview তৈরি হয় এবং একই Admin-এর explicit approval আবশ্যক। Role grants allowlist-based; Administrator/managed roles এবং Bot-এর highest role-এর সমান/উপরের roles বাদ দেওয়া হয়।

Upgrade guide পড়ুন: `DEPLOY_GUIDE_BN_v1.5.47.md`।
