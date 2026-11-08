# RKBACKLES Admin + Discord Bot v1.5.46

এই build-এ আগের Live Stream Radar, ticket transcript archive ও payment/admin features-এর সঙ্গে **AI Role Permissions** যোগ হয়েছে। Admin Panel থেকে role name/ID ও channel name/ID বেছে natural language-এ goal দিলে AI একটি reviewable permission plan তৈরি করে। Admin apply না করা পর্যন্ত Discord-এ কোনো permission পরিবর্তন হয় না। Apply-এর আগে পুরোনো overwrite Firebase-এ backup হয়, এবং UI থেকে revert করা যায়।

প্রথমে [বাংলা Deploy Guide](DEPLOY_GUIDE_BN_v1.5.46.md) পড়ো। AI planner চালু করতে private Bot host-এ `OPENAI_API_KEY` সেট করা প্রয়োজন। Secret key frontend HTML-এ বসানো যাবে না।

- [Changelog](CHANGELOG_BN_v1.5.46.md)
- [Release Notes](RELEASE_NOTES_BN_v1.5.46.md)
- [Test Report](TEST_REPORT_BN_v1.5.46.md)
