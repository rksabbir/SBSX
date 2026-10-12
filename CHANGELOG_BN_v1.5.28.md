# RKBACKLES v1.5.28 — Live Stream Radar & Invite Voice Room

## নতুন ফিচার
- Discord role/OAuth verification ছাড়া invite code redeem করে LiveKit browser room-এ automatic join.
- Multi-use participant invite; default invite-admission limit 10,000, active room participant limit configurable (default 20 including host).
- সদস্যদের Enable Mic, Share Screen/Game, optional screen/tab audio এবং 480p/720p/1080p/1440p/2160p capture-quality preset.
- Fullscreen stage এবং live activity timeline; screen-share, mic, member join/leave ও mute state আপডেট হলে page reload ছাড়া দেখা যায়.
- Premium Admin Panel-এর `LIVE STREAM RADAR` tab: all cached Discord Voice/Stage channels, members, mic/deafen state, Live Studio participants, screen-share state, recent activity, start/create invite/open host/copy invite/mute/unmute/kick/end controls.
- Firebase Realtime Database listener `runtime/liveStreamRadar` দিয়ে Admin Panel auto-sync হয়; Bot প্রতি ৪ সেকেন্ডে Radar snapshot আপডেট করে.
- Bot প্রতিটি eligible, sendable Discord text channel-এ একটি `LIVE STREAM RADAR` status message create/pin করে এবং activity পরিবর্তনে সেই message edit করে; duplicate এড়াতে Firebase message ID ও old pinned/recent message reconcile করে.
- Existing transactions, checkout, payments, coupons, account and Reader screens রেখে দেওয়া হয়েছে.

## Security behavior
- Invite link-ই Live Room admission capability: link পেলে কেউ join, mic enable বা screen share করতে পারবে. তাই শুধু trusted members-এর সঙ্গে share করুন.
- Room Mute/Unmute, Mute Everyone, Kick, Start/End Studio actions existing Firebase Admin API verification ও rate limit-এর পেছনে থাকে; invite guest এই Admin endpoints ব্যবহার করতে পারে না.
- Bot channel message/pinning permission না পেলে সেই channel skip হবে এবং hosting log-এ warning থাকবে.
- LiveKit API key/secret private Render Environment-এ; HTML-এ secret নেই.

## Version & tests
- Package version: `1.5.28`
- `npm test`: 15 passed, 0 failed.
- Main/backend JS syntax and all three HTML inline script syntax: passed.
- Production LiveKit/Discord connection ও Render deploy এখানে করা হয়নি.
