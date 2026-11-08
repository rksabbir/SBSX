# Release Notes — v1.5.43

Live Radar post আর pin হবে না। Live চলাকালে eligible ticket নয় এমন Discord text/announcement channel-এ members-এর Send Messages বন্ধ করে Live শেষে saved original state restore করা হবে। Ticket বন্ধ হলে conversation Firebase-এ backup হয়ে Admin Panel-এর **Closed Ticket Archive**-এ Discord-ধাঁচের chat view-তে দেখা যাবে। Backup write ব্যর্থ হলে channel delete করা হবে না।

Local test suite: **48 passed, 0 failed** at release validation. Live deployment is not included. Discord Administrator/Server Owner permissions can bypass channel locks.
