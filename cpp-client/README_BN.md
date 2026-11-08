# RKBACKLES C++ v1.5.1 — Merge & Real-Time Setup (বাংলা)

এই ফোল্ডারের `RKBACKLES_CPP_SourceSnippet_v1.5.cpp` হলো আপনার আপলোড করা 500-line C++ snippet-এর patched version; এটি পূর্ণ Visual Studio project নয়। Original ImGui render loop, entry-point, project settings এবং সব dependency header দেওয়া হয়নি, তাই এই snippet দিয়ে একা EXE build করা যাবে না।

## পরিবর্তন

- C++ আর Firebase থেকে সরাসরি `users/{username}` বা `keys/{key}` record পড়ে password/key যাচাই করে না। HTTPS Bot API দিয়ে custom session নেয়।
- Bot server-এর `/api/cpp/login` ও `/api/cpp/key-login` credential/key validate করে Firebase custom token দেয়। C++ সেটিকে Firebase ID token-এ exchange করে।
- C++ `cppProfiles/{uid}` path-এ Firebase REST Server-Sent Events (SSE) ব্যবহার করে avatar/status/category/server/expiry updates নেয়।
- প্রতি ~15 সেকেন্ড stream cycle-এ server-verified heartbeat হয়; refresh token দিয়ে ID token refresh হয়। Account expired/suspended বা session replace হলে client access বন্ধ করে।
- libcurl TLS peer/hostname verification চালু; password/token/client credential log করা হয় না।
- নতুন account password scrypt hash হিসেবে save হয়; legacy plaintext password সফল authentication-এর পর migrate হয়।

## আপনার project-এ merge করার ধাপ

1. সম্পূর্ণ Bot v1.5 code deploy করুন। Firebase Admin SDK service account শুধু Render/Railway secret বা private server file-এ রাখুন।
2. Deploy URL health route-এ যাচাই করুন: `https://YOUR-BOT-HOST/api/cpp/health`। `ok: true`, `version: 1.5.0` আসা উচিত।
3. C++ source-এ `CPP_API_BASE_URL`-এর placeholder-কে আপনার deployed Bot HTTPS origin দিয়ে বদলান; trailing slash দেবেন না।
4. আপনার মূল Visual Studio source-এ এই snippet-এর global declarations, secure networking helpers, SSE worker, এবং `NormalUserLogin`/`DeveloperKeyLogin`-এর replacement merge করুন। Duplicate old definitions রেখে দেবেন না। Project C++17 এবং libcurl, nlohmann/json, ImGui, stb_image, Direct3D 11-এর আগের dependency/link settings বজায় রাখুন।
5. ImGui render loop-এ worker-thread থেকে `g_CurrentUser`-কে unsynchronized ভাবে পড়বেন না; `GetCurrentUserSnapshot()` থেকে copy নিন। Logout button ও application shutdown-এ `LogoutCppSession()` call করুন।
6. Firebase Authentication চালু থাকতে হবে (custom token sign-in ব্যবহৃত হয়)। Deployable rules-এ `cppProfiles/{uid}`-এর read শুধু `auth.uid == uid`-এ অনুমোদিত, client write বন্ধ। Admin SDK server-side profile mirror update করে।
7. Bot ও C++ client একসঙ্গে update করুন। পুরোনো C++ binary direct RTDB read/write করলে default-deny rules-এর পরে আর চলবে না।

## Real-time timing

Profile changes active SSE connection-এ event হিসেবে আসে; worker প্রায় 15 সেকেন্ড পর stream বন্ধ করে token refresh/heartbeat-এর জন্য reconnect করে। Network interruption-এ retry আছে। এটি real-time stream architecture, কিন্তু millisecond delivery SLA নয়।

## পরীক্ষার সীমা

Node.js syntax ও config checks করা হয়েছে। Windows/MSVC build, user-owned ImGui render-loop integration, Firebase Auth token exchange, Rules simulator এবং live account login এই পরিবেশে চালানো হয়নি। Complete `.sln`/`.vcxproj`/EXE না থাকায় full app compile নিশ্চিত করা যায় না।

## MSVC compile hotfix v1.5.1

- `windows.h`-এর `min` macro-এর কারণে `std::min(...)`-এ MSVC error `\'(\': illegal token on right side of \'::\'` হতে পারে। `NOMINMAX` define এবং `(std::min)(...)` ব্যবহার করে এই macro conflict ঠিক করা হয়েছে।
- এটি source-level fix; পূর্ণ Visual Studio solution না থাকায় complete MSVC build এখনও চালানো যায়নি।
