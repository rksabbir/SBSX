# RKBACKLES v1.5.42 — Release Notes

এই সংস্করণে Live শেষ হওয়ার পরও থেকে যাওয়া Discord-এর “pinned a message to this channel” system notice পরিষ্কারের জন্য fix যোগ করা হয়েছে। নতুন Bot runtime-এ নিজস্ব Radar pin notice আসার সঙ্গে সঙ্গে delete করার চেষ্টা করবে, আর Live-end cleanup পুরোনো notice-ও খুঁজবে।

- Existing payment, order, C++ account, Reader, ticket and Admin Panel features preserved.
- New pin notification cleanup is scoped to the Bot's Live Stream Radar activity.
- Tests: 45 passed, 0 failed.
- Must redeploy the Bot on Render before the fix takes effect; no live deployment has been performed from this session.
