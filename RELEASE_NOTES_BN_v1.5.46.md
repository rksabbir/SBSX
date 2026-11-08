# RKBACKLES v1.5.46 — Release Notes

এই release-এ Admin Panel-এর জন্য AI-ভিত্তিক Discord Role/Channel Permission Planner যোগ হয়েছে। Role ও channel নির্বাচন করে নিজের ভাষায় কাজের নিয়ম লিখলে AI proposed permissions সাজাবে। Proposal review এবং explicit Apply ছাড়া কোনো permission change হবে না।

Apply-এর আগে পুরোনো target-role overwrite Firebase-এ save হয় এবং পরবর্তীতে Revert করা যায়। Tool কেবল allowlisted channel permissions পরিবর্তন করে; এটি server-wide Administrator বা Manage Roles permission দিতে পারে না।

**AI চালু করতে:** Bot hosting environment-এ `OPENAI_API_KEY` সেট করুন। চাইলে `OPENAI_ROLE_PERMISSIONS_MODEL=gpt-5.4-mini` সেট করুন। Key Admin Panel HTML-এ দেবেন না।
