# RKBACKLES v1.5.45

মূল পরিবর্তন: আগে থেকে যেসব role/member-এর channel overwrite-এ `Send Messages: Deny` রয়েছে, সেগুলো touch করা হবে না। Bot online হলে saved active Live session থাকলে তা recover করে Live restrictions ও pin cleanup আবার চালু করবে। Live session না থাকলে বা শেষ হয়ে গেলে আগের Send Messages states restore করার routine স্বয়ংক্রিয়ভাবে চলবে।

Live Radar pin হয় না; ticket channel-এ temporary message lock প্রয়োগ হয় না।
