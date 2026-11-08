# RKBACKLES v1.5.43 — Changelog (বাংলা)

- Live Stream Radar মেসেজ আর pin করা হয় না; live চলাকালে আগের সংস্করণের Radar pin পাওয়া গেলে unpin/cleanup করার চেষ্টা করে।
- Live চলাকালে ticket/support channel বাদে eligible Discord text ও announcement channel-এ `Send Messages` সাময়িকভাবে বন্ধ হয়। Live শেষ হলে Bot Firebase-এ সংরক্ষিত আগের permission state ফিরিয়ে দেয়।
- মূল permission snapshot Firebase-এ সফলভাবে সংরক্ষণ না হলে Bot ওই channel lock করবে না, যাতে restart-এর পরে channel আটকে থাকার ঝুঁকি না থাকে।
- Ticket channel Radar post বা live lock থেকে বাদ থাকে; আগের সংস্করণের Radar post ticket-এ থাকলে সেটি cleanup করার চেষ্টা করা হয়।
- Ticket close করার সময় message history, author, timestamps, attachments ও embed summary Firebase `ticketTranscripts`-এ সংরক্ষণ করা হয়; `ticketTranscriptIndex` Admin Panel-এর list/search-এ ব্যবহার হয়।
- Admin Panel-এ “Closed Ticket Archive” যোগ হয়েছে; ticket select করলে Discord-ধাঁচের chat view-তে সংরক্ষিত conversation দেখা যায়।
- Firebase archive লিখতে ব্যর্থ হলে ticket channel delete করা হয় না।

## সীমাবদ্ধতা

- Discord-এর Administrator permission ও Server Owner channel overwrites bypass করতে পারেন; Bot permission overwrite দিয়ে তাদের message সম্পূর্ণ বন্ধ করতে পারে না।
- Bot-এর role permissions ও role hierarchy সঠিক হতে হবে; `Manage Channels`/`Manage Roles` না থাকলে lock/restore ব্যর্থ হতে পারে।
- এই সংস্করণ deploy হওয়ার পর বন্ধ হওয়া ticket-গুলিই নতুন in-panel archive-এ আসবে। পুরোনো transcript আলাদাভাবে import করা হয়নি।
- Discord attachment URL সময়ের সঙ্গে expire হতে পারে।
