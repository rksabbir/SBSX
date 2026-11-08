# Changelog — RKBACKLES v1.5.45

- Bot restart-এর পর Firebase-এ saved এবং LiveKit-এ এখনও running Live session স্বয়ংক্রিয়ভাবে recover হবে।
- Bot online হলে Radar refresh, non-ticket channel lock, pin sweep ও permission restore process নিজে থেকে চালু হবে।
- Explicit `Send Messages: Deny` থাকা role/member overwrite temporary lock target করা হয় না; আগের state বদলানো হবে না।
- Live শেষে শুধু Bot যে Send Messages states পরিবর্তন করেছে সেগুলো recorded snapshot থেকে restore হবে।
- Live session/invite/mute/use-count state Firebase runtime-এ রাখা হয়; expiry/closed LiveKit room পাওয়া গেলে stale session পরিষ্কার করে saved channel permissions restore হয়।
- Live Radar message pin করা হয় না, এবং Live চলাকালে bot-authored pin সরানোর sweep/event handler থাকে।
