# RKBACKLES Admin + Discord Bot v1.5.47

এই build-এ আগের Live Stream Radar, AI role/channel permission planner, closed-ticket transcript archive, payment/admin controls-এর সঙ্গে Community Automation Center যোগ হয়েছে।

## নতুন Community Automation
- Smart onboarding DM এবং নিরাপদ auto-role assignment; optional self-service role picker (`!roles`)
- FAQ knowledge base, exact FAQ lookup এবং optional OpenAI fallback (`!faq`)
- Smart ticket/category guidance (`!tickethelp`)
- AI-generated keyword auto-reply rule-এর preview → admin approval → apply workflow
- Suggestion + reaction vote (`!suggest`) এবং Admin Panel থেকে Pending/Approved/Rejected/Completed status; admin poll (`!poll প্রশ্ন | Option 1 | Option 2`)
- Event reminders, opt-in notifications (`!notify on|off`)
- XP/Level command (`!rank`, `!leaderboard`, `!profile`)
- Daily community analytics, anti-raid join-spike alerts ও Admin/Staff error alerts
- Live, ticket archive, audit trail ও role permission backup/revert-এর আগের feature-গুলো অক্ষত।

## Setup
প্রথমে [বাংলা Deploy Guide](DEPLOY_GUIDE_BN_v1.5.47.md) পড়ুন। AI feature চালাতে private Bot host-এ `OPENAI_API_KEY` দিতে হবে। `OPENAI_FAQ_MODEL`, `OPENAI_AUTOMATION_MODEL` ও `OPENAI_ROLE_PERMISSIONS_MODEL` ঐচ্ছিক model selector। কোনো secret HTML/Blogger APK বা browser-এ বসাবেন না। Admin Panel-এ `Controls` থেকে প্রয়োজনীয় feature flag চালু করতে হবে; FAQ feature default-এ Off থাকে।

## Tests
Local automated suite: [Test Report](TEST_REPORT_BN_v1.5.47.md) এবং [Test Log](discord-bot/TEST_LOG_v1.5.47.txt)। এই tests live Discord/Firebase/OpenAI deployment test-এর বিকল্প নয়।

- [Changelog](CHANGELOG_BN_v1.5.47.md)
- [Release Notes](RELEASE_NOTES_BN_v1.5.47.md)
