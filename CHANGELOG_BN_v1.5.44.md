# Changelog — RKBACKLES v1.5.44

## Live channel restriction and bot pins
- Live চালু হলে ticket/support channel বাদে eligible Discord text ও announcement channel-এ `Send Messages` সাময়িকভাবে deny করা হয়। Explicit role/member allow-overwrite-ও সংরক্ষণ করে সাময়িক deny করা হয়।
- Live শেষ হলে Firebase-এ রাখা snapshot থেকে আগের `Send Messages` permission state ফিরিয়ে আনা হয়। Snapshot save ব্যর্থ হলে channel lock করা হয় না।
- নতুন Live Stream Radar message কখনো pin হয় না। Live শুরুতে সব cached text/announcement channel-এ আগে থেকে pinned bot-authored messages unpin করার scan চলে—ticket channel-ও pin-cleanup-এর আওতায় থাকে, তবে ticket chat lock হয় না।
- Live চলাকালে Discord `channelPinsUpdate` event এলে ঐ channel-এর bot-authored pinned messages unpin করার চেষ্টা হয়।
- Closed Ticket Archive এবং Firebase backup fail-safe v1.5.43 থেকে অপরিবর্তিত রয়েছে।

## সীমা
- Discord bot-কে `Manage Messages` দিতে হবে, এবং channel overwrites পরিবর্তন করার উপযুক্ত permission ও role hierarchy থাকতে হবে।
- Administrator permission/Server Owner-এর bypass থাকলে তাঁদের message lock করা যায় না; এই server-এ যদি কোনো role-এ Administrator না থাকে, regular roles ও members lock-এর আওতায় থাকবে।
- বাস্তব Discord/Firebase/hosting deploy এখানে করা হয়নি; deploy-এর পর test channel-এ যাচাই করতে হবে।
