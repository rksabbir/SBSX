# RKBACKLES v1.5.1 — Secure C++ Real-Time Bridge, Bot Controls & Advanced Checkout

এই সংস্করণে running Discord Bot-কে Firebase-এর real-time configuration listener দিয়ে চালানো হয়েছে। Admin Panel থেকে presence, configurable message templates, managed Discord panel appearance/routing, checkout session lifetime, partial-payment policy এবং transaction evidence approve/reject করা যায়। Bot online থাকলে configuration save করার পর নতুন settings redeploy ছাড়াই apply হবে। Discord permissions, process restart এবং official payment-provider verification আলাদা বিষয়—নিচের সীমাবদ্ধতা পড়ুন।

# v1.5.2 — C++ app-এর বাস্তব real-time bridge

এই সংস্করণে দেওয়া C++ source snippet-কে সরাসরি user/password database read থেকে সরিয়ে Bot server-এর trusted session API-তে নেওয়া হয়েছে। সফল login-এর পরে Firebase custom token exchange করে scoped ID token পাওয়া যায় এবং C++ `cppProfiles/{uid}`-এর Server-Sent Events (SSE) stream শোনে। Bot-side profile changes (status, avatar, category, server name, expiry/access revoked) stream-এ আসে; প্রতি stream cycle-এ server-verified heartbeat চলে এবং session/token refresh হয়। libcurl TLS certificate/hostname verification চালু করা হয়েছে।

**গুরুত্বপূর্ণ scope:** আপলোড করা C++ ছিল 500-line source snippet; সম্পূর্ণ Visual Studio solution, main/render loop এবং ImGui rendering source দেওয়া হয়নি। তাই ZIP-এ patched file `cpp-client/RKBACKLES_CPP_SourceSnippet_v1.5.cpp` আছে—এটি আপনার সম্পূর্ণ `.cpp`/`.sln`/EXE-র বদলি নয়। আপনার app-এর বাকি source-এ integration করতে হবে (নিচে গাইড আছে)। Windows/MSVC/DirectX build এই পরিবেশে করা হয়নি।

## v1.5.2 C++-এর নতুন অংশ

- **Server-side custom login:** `/api/cpp/login` ও `/api/cpp/key-login` account/password এবং one-time key যাচাই করে; client আর Firebase `users/{username}` বা `keys/{key}` record পড়ে না।
- **Password hardening:** নতুন account-এর password scrypt hash হিসেবে সেভ হয়; পুরোনো plaintext account সফল login-এর পর hash-এ migrate হয়।
- **Authenticated profile mirror:** password/private fields ছাড়া sanitized profile শুধু `cppProfiles/{uid}` path-এ mirror হয়; client শুধু নিজের UID-এর profile read করতে পারে।
- **SSE profile sync:** periodic full-profile polling-এর বদলে Firebase REST `text/event-stream`; stream window bounded রেখে token refresh ও heartbeat করে reconnect হয়।
- **Session enforcement:** account suspended/expired, key revoked, অথবা অন্য login session replace করলে heartbeat fail-closed করে app access বন্ধ করে।
- **TLS/network reliability:** certificate এবং hostname verification, connect/overall timeout, bounded retries, Firebase ID-token refresh যোগ হয়েছে।
- **Logout API:** `LogoutCppSession()` যোগ হয়েছে; app-এর Logout button এবং application shutdown path-এ এটি call করতে হবে।

## v1.4.0-এ নতুন

- **Live Bot identity:** activity text/type এবং online/idle/DND/invisible status বদলানো যায়।
- **Custom message templates:** welcome, verification, verification success, caps warning, anti-link warning, automod warning, timeout, level-up ও checkout-unavailable message; supported placeholders UI-তে দেয়া আছে।
- **Managed Discord panel sync:** Payment, Ticket, Report, Customer, One-Time Key ও Order Guide panel online Bot দিয়ে create/edit করা হয়। Channel ID বদলালে tracked old Bot-owned panel message delete করার চেষ্টা করে এবং নতুন destination-এ message sync করে।
- **Panel appearance:** title, description, HTTPS image, hex color, footer, dropdown placeholder এবং options customization।
- **Advanced checkout:** partial payment ON/OFF এবং checkout session lifetime (1–720 hours)। Existing Reader-online fail-closed policy অপরিবর্তিত।
- **Transaction review:** Admin panel থেকে payment evidence approve অথবা reject করা যায়; rejected TxnID credit করা হয় না।
- আরও Discord destination channel ID routing এখন Panel থেকে configure করা যায়।

# RKBACKLES — Discord Bot, Android Payment Reader ও Blogger Admin Panel

এই আপডেটে আপনার ZIP-এর বিদ্যমান **Node.js + discord.js v14** Bot এবং Kotlin Android Reader রেখে Firebase Realtime Database-ভিত্তিক responsive Blogger Admin Panel যোগ করা হয়েছে। পুরোনো প্রধান paths (`reader_devices`, `reader_events`, `settings`, `panels`, `pending_payments`, `transactions`, `coupons`, `user_settings`, `users`, `keys`) অকারণে rename করা হয়নি।

> **পেমেন্ট নিরাপত্তা:** Android notification বা TxnID match একা official payment proof নয়। Bot এখন Reader notification-কে `evidence_matched` হিসেবে রাখে। Admin-কে provider-এর official account/merchant history দেখে Panel থেকে approve করতে হবে; তারপর ক্রেতা একই TxnID আবার submit করলে flow চলবে। bKash/Nagad official Merchant API/Webhook এই ZIP-এ নেই।

## 1. ZIP-এ কী যোগ হয়েছে

- `admin-panel/blogger-admin-panel.html` — Firebase Email/Password login, authorized UID check, premium dark responsive Dashboard, Bot/Reader heartbeat, granular controls, payment/package settings, order/transaction/coupon tables এবং audit log।
- `firebase/database.rules.json` — default-deny rules, admin UID allowlist, Android Reader-এর own-UID write এবং admin-only dashboard paths। Rules deploy করার আগে বর্তমান rules ও legacy C++ schema-এর সঙ্গে merge/review করতে হবে।
- Bot live config listener: `adminConfig/bot` থেকে feature flags, payment/package/coupon settings, automod thresholds, leveling values এবং Discord channel/role IDs live sync করে; heartbeat `runtime/bot`-এ প্রতি 30 সেকেন্ডে লেখে।
- **Automation & routing** section: caps/anti-link/blocked-word/spam controls, XP values, verification URL, Discord channel/role IDs এবং panel title/description/image/dropdown options বদলানো যায়।
- ছয়টি Discord panel editor: `payment`, `ticket`, `report`, `customer`, `onetime_key`, `order_guide`। Running Bot listener সংশ্লিষ্ট existing panel message update করে, প্রয়োজন হলে create করে এবং configured channel বদলালে managed panel relocate করে।
- Feature switches: payment/checkout/maintenance, auto coupons, giveaway joins, ticket/support, verification, automod ও sub-switches, leveling, welcome/leave, One-Time Key, profile sync, order tracking, transcript logs, weekly report ও voice stats।
- Weekly message counter, voice-session duration collector এবং basic 7-day activity report scheduler যোগ করা হয়েছে। এগুলো source-level implemented, তবে real Discord/Firebase environment-এ regression testing বাকি।
- Manual overpayment coupon request `couponRequests`-এ যায়; Panel approve করলে Bot deterministic code-এ coupon একবার তৈরি করে।
- Payment notification match থেকে automatic `verified`/account credit বন্ধ করা হয়েছে। Transaction review `manual_admin_review` হিসেবে চিহ্নিত হবে; provider API/webhook এই ZIP-এ নেই।

## 2. গুরুত্বপূর্ণ path

```text
adminUids/{firebaseAuthUid}                 # Admin allowlist; Firebase Console দিয়ে seed
adminConfig/bot/features                    # Bot feature switches
adminConfig/bot/checkout                    # Checkout policy; Reader required থাকে
adminConfig/bot/payment                     # bKash/Nagad number + instructions
adminConfig/bot/packages                    # weekly/monthly/twoMonths price + enabled
adminConfig/bot/coupons                     # enabled, overpaymentMode, expiryDays
runtime/bot                                 # Bot heartbeat/host/version
reader_devices/{readerUid}                  # Existing Android heartbeat
reader_events/{readerUid}/{txnId}           # Existing Reader evidence
pending_payments/{discordUid}_{package}     # Existing checkout sessions
transactions/{txnId}                        # TxnID evidence and review status
coupons/{code}                              # Coupon balance/lifecycle
couponRequests/{requestId}                  # Manual overpayment coupon approvals
auditLog/{eventId}                          # Admin action history
adminActions/{eventId}                      # Compatibility/action mirror
```

`adminConfig/bot`-এর প্রাথমিক প্রত্যাশিত মান:

```json
{
  "features": {
    "paymentBotEnabled": true,
    "checkoutEnabled": true,
    "maintenanceMode": false,
    "autoCouponEnabled": true,
    "giveawayEnabled": true,
    "ticketPanelEnabled": true,
    "verificationEnabled": true,
    "automodEnabled": true,
    "levelingEnabled": true,
    "weeklyReportEnabled": true,
    "voiceStatsEnabled": true
  },
  "checkout": { "readerRequired": true },
  "payment": {
    "bkashNumber": "",
    "nagadNumber": "",
    "instructions": ""
  },
  "packages": {
    "weekly": { "price": 510, "enabled": true },
    "monthly": { "price": 1510, "enabled": true },
    "twoMonths": { "price": 2410, "enabled": true }
  },
  "coupons": {
    "enabled": true,
    "overpaymentMode": "auto",
    "expiryDays": 90
  }
}
```

এই sample-টি বোঝার জন্য; আপনার database-এ existing values থাকলে আগে export/backup নিন, তারপর merge করুন।

## 3. Firebase ও Admin UID setup

1. Firebase Console → Project `rkbackles` → Authentication → Sign-in method-এ **Email/Password** enable করুন। Android Reader-এর বর্তমান code Anonymous Auth ব্যবহার করে, তাই **Anonymous** provider-টিও enabled রাখুন।
2. Authentication → Users থেকে Admin account তৈরি করুন। সেই account দিয়ে Dashboard-এ প্রথমবার sign in করার আগে UID কপি করুন।
3. Realtime Database Console-এ privileged Admin account দিয়ে `adminUids/{UID}` path-এর value Boolean `true` সেট করুন। উদাহরণ `adminUids/abc123... = true`। এটি browser panel থেকে তৈরি/পরিবর্তন করা যাবে না; Firebase Console বা trusted server দিয়ে করুন।
4. বর্তমান Database Rules export/backup নিন। `firebase/database.rules.json`-এর rules সম্পূর্ণ replace করার আগে C++ application-এর existing legitimate read/write paths যাচাই করুন। আপলোড করা C++-এর আংশিক source snippet এখন `cpp-client/RKBACKLES_CPP_SourceSnippet_v1.5.cpp`-এ patched হয়েছে। সম্পূর্ণ Visual Studio project/render source ও deployed rules দেওয়া হয়নি; তাই নিচের C++ integration guide না পড়ে production Rules replace করবেন না। v1.5 client সরাসরি `users`/`keys` পড়বে না—শুধু authenticated `cppProfiles/{uid}` stream পড়বে।
5. `firebase/database.rules.json`-এর rules deploy করুন বা আপনার যাচাইকৃত rules-এ merge করুন। Reader `reader_devices/{uid}` এবং `reader_events/{uid}/{txnId}`-তে কেবল তার Firebase auth UID-এর অধীনে লিখতে পারবে। Bot service account Admin SDK rules bypass করে—এটি শুধু trusted Bot host-এ থাকবে।
6. Firebase Project settings → Your apps-এ **Web app** register করুন। Web config থেকে `apiKey` ও `appId` নিন। API key Firebase Web SDK-র public client identifier; service-account JSON নয়।
7. এই build-এর `admin-panel/blogger-admin-panel.html`-এ `firebase/web-config.js` থেকে পাওয়া public Web App config ইতিমধ্যে বসানো আছে। Firebase Console-এর Web App config-এর সঙ্গে মিলিয়ে নিন; `apiKey`/`appId` placeholder দেখালে পুরোনো HTML নয়, updated file ব্যবহার করুন। Blogger domain Firebase Authentication → Settings → Authorized domains-এ যোগ করতে হবে।

## 4A. C++ Real-Time integration (v1.5.2)

1. Bot-এর নতুন source deploy/redeploy করতে হবে; `discord-bot/index.js`-এ `/api/cpp/login`, `/api/cpp/key-login`, `/api/cpp/heartbeat`, `/api/cpp/logout`, `/api/cpp/log` endpoints আছে। Firebase service-account JSON/`FIREBASE_CONFIG` কেবল server host-এ দিন।
2. Deploy হওয়ার পরে `https://YOUR-BOT-HOST/api/cpp/health` খুলে `ok: true` ও `version: 1.5.0` আসছে কি না যাচাই করুন। এই health route শুধু server running যাচাই করে; live login test নয়।
3. `cpp-client/RKBACKLES_CPP_SourceSnippet_v1.5.cpp` খুলে `CPP_API_BASE_URL`-এর `https://YOUR-RKBACKLES-SERVICE.onrender.com`-কে আপনার আসল Bot service HTTPS origin দিয়ে বদলান; শেষের `/` বাদ দিন। উদাহরণ: `https://your-service.onrender.com`। এটা public API URL, secret নয়।
4. C++ project-এ C++17, libcurl, nlohmann/json, ImGui, stb_image এবং Direct3D 11 dependencies আগের মতো রাখুন। এই file-টি source snippet—সম্পূর্ণ EXE/solution নয়; আপনার মূল project-এ global/network/sync/login অংশ merge করুন, duplicate `NormalUserLogin`, `DeveloperKeyLogin`, `PerformHTTPRequest` এবং `StartRealtimeSyncThread` definitions একাধিক রাখবেন না।
5. ImGui/render code-এ `g_CurrentUser` সরাসরি worker thread থেকে পড়ার বদলে `GetCurrentUserSnapshot()` দিয়ে value-copy নিন। Logout button এবং app shutdown handler-এ `LogoutCppSession()` call করুন। Application startup/shutdown-এ worker thread stop/joins নিশ্চিত করুন।
6. Firebase Console → Authentication enabled থাকতে হবে, কারণ Bot custom token তৈরি করে এবং C++ সেটিকে Firebase ID token-এ exchange করে। Web API key public client config; service-account JSON, Discord token অথবা private key C++/Blogger-এ রাখবেন না।
7. `cppProfiles` rules শুধুমাত্র `auth.uid == path uid` হলে profile পড়তে দেয়; profile client থেকে write করা যায় না। C++ profile update Admin SDK দিয়ে Bot mirror করে। Rules deploy করার আগে existing C++ binary আর C++ paths-এ direct database writes আছে কি না যাচাই করুন; পুরোনো binary এই নতুন bridge ছাড়া চলবে না।

**Real-time behavior:** Firebase SSE connection-এর সময় profile changes সঙ্গে সঙ্গে stream event হিসেবে আসে। Connection প্রতি প্রায় 15 সেকেন্ডে refresh/heartbeat-এর জন্য reconnect হয়; network interruption হলে retry করে। এটি server-sent real-time streaming, exact millisecond latency SLA নয়।

### Blogger Page-এ বসানো

1. Blogger → Pages → New Page তৈরি করুন, যেমন `Admin Console`।
2. Page editor-এ HTML view ব্যবহার করুন। Template/editor যদি `doctype`, `html`, `head`, `body` tag সরিয়ে দেয়, তাহলে file-টির `<body>`-এর ভিতরের markup এবং `<style>`/Firebase `<script>` block-গুলোকে Blogger-compatible ভাবে theme/template-এ যুক্ত করতে হতে পারে।
3. Blogger editor inline JavaScript sanitize করলে একই `blogger-admin-panel.html` Firebase config পূরণ করে আপনার বিশ্বস্ত HTTPS static hosting-এ publish করে Blogger Page-এ iframe/embed করুন। কোনো অবস্থাতেই Auth/Rules বাদ দিয়ে public database access দেবেন না।
4. `/p/admin.html` URL গোপন রাখাই access control নয়। Firebase Auth + `adminUids` check + Database Rules-ই নিরাপত্তার boundary।

## 5. Discord Bot server / Render / Railway

`discord-bot/.env.example` থেকে local/server environment তৈরি করুন। ZIP-এ আসল credential রাখা হয়নি।

Required variables:

```env
TOKEN=YOUR_DISCORD_BOT_TOKEN
FIREBASE_DB_URL=https://rkbackles-default-rtdb.firebaseio.com
FIREBASE_CONFIG=
PORT=3000
PAYMENT_READER_UIDS=PASTE_TRUSTED_ANDROID_READER_UID
READER_ONLINE_WINDOW_MS=90000
READER_RECHECK_COOLDOWN_MS=15000
READER_AUTO_WATCH_INTERVAL_MS=15000
READER_AUTO_WATCH_TIMEOUT_MS=300000
PAYMENT_TXN_SUBMIT_COOLDOWN_MS=15000
BKASH_PAYMENT_NUMBER=
NAGAD_PAYMENT_NUMBER=
```

- Firebase service account JSON শুধু private Bot host-এ `discord-bot/firebase-service-account.json` নামে রাখুন, অথবা `FIREBASE_CONFIG` environment secret-এ পুরো JSON দিন। কোনোটিই Blogger HTML, APK বা public repository-তে রাখবেন না। `.gitignore` already service-account files ignore করে।
- `TOKEN` Discord Bot token। এটি project file-এ paste করবেন না।
- `PAYMENT_READER_UIDS`-এ Android Reader app-এর **Copy trusted Reader UID** থেকে পাওয়া UID দিন। Dashboard Reader device discover করতে পারে, কিন্তু কোন Reader trusted তা Bot server-এর UID allowlist-ই নির্ধারণ করে।
- Payment numbers Dashboard থেকে `adminConfig/bot/payment`-এ save করুন। Admin config path সেট হলে সেটিই legacy env number-এর ওপরে priority পাবে। Valid নম্বর না থাকলে বট নম্বর দেখাবে না।
- Render-এ Root Directory `discord-bot`, Build Command `npm install`, Start Command `npm start` ব্যবহার করতে পারেন। Railway-তে একই directory-তে deploy করুন। Node.js 20+ প্রয়োজন।
- Local source check: `cd discord-bot && npm install && npm run check`।

## 6. Dashboard কীভাবে চালাতে হবে

1. Auth-enabled admin account দিয়ে sign in করুন। UID `adminUids/{uid} = true` না হলে page sign-in reject করবে।
2. **Bot controls**-এ প্রয়োজনীয় switches বদলে Save করুন। Checkout বা Maintenance mode বন্ধ থাকলে Bot-এর checkout actions block হবে। Supported flags সঙ্গে সঙ্গে Firebase listener-এর মাধ্যমে প্রযোজ্য হয়।
3. **Payments & packages**-এ bKash/Nagad number, payment instruction, package price/enabled status এবং coupon policy সেট করে Save করুন। Bot shop panel refresh করবে।
4. Reader offline থাকলে checkout number reveal করবে না—`readerRequired` preference যাই লেখা থাকুক না কেন এই fail-closed policy চালু থাকবে। Optional Reader mode-এর জন্য আলাদা verified payment source না থাকা পর্যন্ত তা bypass করা হয় না।
5. **Transactions**-এ `evidence_matched` record দেখলে প্রথমে bKash/Nagad-এর authoritative transaction history-তে independent check করুন। নিশ্চিত হলে `Approve after external check` চাপুন। Bot payment credit করার আগে customer-কে একই TxnID আবার submit করতে হবে।
6. **Coupons**-এ manual overpayment requests approve/reject করুন। Approve করলে Bot unique requested code তৈরি করবে; কোনো error state থাকলে audit/event record দেখে ব্যবস্থা নিন।
7. **Audit activity**-তে Admin UID, action, timestamp ও summary দেখা যাবে। Password, service account বা complete payment notification এখানে log হয় না।

## 7. Payment / coupon semantics

- Reader heartbeat পুরোনো হলে Online দেখানো হয় না; default heartbeat window 90 সেকেন্ড। Bot heartbeat `runtime/bot.lastHeartbeatAt` প্রতি 30 সেকেন্ডে আপডেট হয়। Dashboard 90 সেকেন্ডের বেশি পুরোনো heartbeat-কে offline দেখায়।
- Reader notification-এর TxnID, provider ও amount মিললে `transactions/{txnId}`-এ `verificationStatus: evidence_matched` এবং `verificationSource: reader_notification_evidence` রেকর্ড হয়। এটা automatic payment credit নয়।
- Admin manual verification শেষে `verificationStatus: verified`, `verificationSource: manual_admin_review`, `reviewedBy` এবং `reviewedAt` লেখা হয়। এরপর customer একই TxnID পুনরায় submit করলে duplicate claim protection-এর পরে checkout চলতে পারে। Official server API integration পরে যুক্ত হলে `verificationSource: official_api` ব্যবহার করতে হবে—বর্তমান ZIP এ সেই integration নেই।
- Duplicate TxnID transaction claim ও Android `if-match: null_etag` logic বজায় আছে। Coupon balance consume/reservation existing Firebase transactions দিয়ে করা হয়। Manual coupon approval deterministic `couponCode` ও `sourceRequestId` ব্যবহার করে পুনরায় listener fire হলেও একই request থেকে দ্বিতীয় coupon তৈরি হতে দেয় না।
- Overpayment Mode `auto` হলে already reviewed payment overpayment থেকে coupon তৈরি হয়। `manual` হলে `couponRequests`-এ pending request তৈরি হয়। Coupon system OFF থাকলে নতুন coupon reward তৈরি হয় না।

## 8. কোন ফিচার live, কোনটি সীমিত

**Code-level integration করা হয়েছে:** live admin config listener; 23টি feature flags; automod thresholds ও sub-switches; leveling/XP rules; Discord channel/role routing; ছয়টি panel-এর title/description/image/options; payment numbers/instructions; package prices/availability; checkout/maintenance gates; Reader fail-closed policy; Auto Coupon master toggle; overpayment auto/manual mode; coupon approval listener; transaction evidence/manual review flow; Bot heartbeat; weekly message/voice counters ও basic 7-day report; admin audit log এবং dashboard search/tables/status views।

**বিদ্যমান source থেকে preserve করা হয়েছে, কিন্তু full regression হয়নি:** verification/welcome, ticket/support/report panels, One-Time Key, account creation/membership logic, giveaway joining, coupon lifecycle, automod/leveling, user/profile sync, Android Reader notification filters ও legacy C++ data schema usage। Discord/Firebase credentials এবং server permissions ছাড়া live regression সম্ভব নয়।

**এখনও implementation বা external credentials দরকার:** bKash/Nagad official Merchant API/Webhook; Render/Railway process start/restart via provider API (host API endpoint/credentials দেওয়া হয়নি); unseen C++ client's precise Database Rules (C++ source/current deployed rules দেওয়া হয়নি)। Weekly report ও voice stats-এর basic handlers যুক্ত হয়েছে, কিন্তু production-এ live পরীক্ষা হয়নি।

## 9. Troubleshooting

- **Admin login succeeds but unauthorized UID:** Firebase Console → Authentication → Users-এ একই account-এর UID নিন এবং root path `adminUids/{exactUid}`-এ Boolean `true` লিখুন। String `"true"` নয়।
- **Permission denied:** current deployed Rules, Firebase web app project, logged-in UID এবং `adminUids/{uid}` path মিলিয়ে দেখুন। Dashboard code দিয়ে rules bypass করার চেষ্টা করবেন না।
- **Reader offline:** Android app-এর Notification Access on আছে কিনা, Firebase Anonymous Auth enabled কিনা, Reader UID সঠিক `PAYMENT_READER_UIDS`-এ আছে কিনা ও heartbeat fresh কিনা পরীক্ষা করুন।
- **Payment number hidden:** নিরাপত্তা policy অনুযায়ী Reader online না হলে number দেখাবে না। Valid `01[3-9]XXXXXXXX` নম্বর দিন।
- **TxnID evidence matched, not verified:** এটি প্রত্যাশিত আচরণ। Official provider account/merchant statement check করে Panel থেকে approve করতে হবে; notification একা প্রমাণ নয়। তারপর customer একই TxnID আবার submit করবে।
- **Coupon approval stuck/error:** `couponRequests/{id}`-এর status/errorCode, Bot logs, `coupons/{code}` conflict এবং `runtime/bot` heartbeat পরীক্ষা করুন।
- **Blogger Page blank / scripts stripped:** Blogger HTML editor may sanitize full-document tags. Follow the Blogger hosting note above and inspect browser console; do not disable Firebase security rules to fix embedding.

## 10. Test report

`TEST_REPORT_BN.md`-এ source-level validation এবং untested live checks আলাদা করে দেওয়া হয়েছে। এই build-এ real Firebase project credentials, Discord Bot token, Android SDK/device, provider merchant API বা hosting credential পাওয়া যায়নি; তাই কোনো live sign-in, payment, APK build বা Discord regression test সম্পন্ন হয়েছে বলে দাবি করা হচ্ছে না।


## v1.5.1 hotfix

C++ source fixed for MSVC `\'(\': illegal token on right side of \'::\'` by protecting against the Windows `min` macro around `std::min`. See `cpp-client/README_BN.md`.


## v1.5.2 Checkout lock fix
- Fixed stuck `checking_reader` checkout sessions with token-owned state transitions and a recoverable lease.
- Failed online checks release their lease and show retry buttons; stale workers cannot overwrite a newer result.
- Run `npm test` in `discord-bot/` to test the checkout state machine.


## v1.5.4 account lock ও offline payment flow
- Reader offline হলে checkout-এ Offline payment request ও Request status বোতাম দেখায়।
- Offline request `offline_payment_requests`-এ সংরক্ষিত হয় এবং configured staff/admin review channel-এ approve/reject buttons যায়। Approve করার আগে official bKash/Nagad history manually যাচাই করতে হবে।
- Approve হলে user একই package আবার select করে account credential create করতে পারে; request pending/rejected হলে bot duplicate request ঠেকায়।
- C++ account API-তে `HWID` (এক PC binding) ও `ONLINE` (এক active session) lock mode server-side enforce হয়। `CPP_SESSION_STALE_MS` default 120000 ms; heartbeat বন্ধ থাকলে stale session reclaim করা যায়।
- Admin Panel-এর C++ Accounts page দিয়ে username/password/HWID/lock mode/status পরিবর্তন করা যায়। পরিবর্তনের পর active session invalidated হয়। এই endpoints চালাতে Bot host-এ v1.5.4 deploy করতে হবে; Blogger HTML একা account mutation করতে পারে না।


## v1.5.4 — এই সমস্যার জন্য অতিরিক্ত সেটআপ

- C++ Accounts পেজের **Bot API HTTPS URL**-এ running Bot hosting-এর base URL দিন (উদাহরণ `https://your-bot-service.example.com`, Blogger domain নয়) এবং **Test API connection** চাপুন। Success না হলে C++ account save কাজ করবে না।
- Bot host environment: `ADMIN_PANEL_ORIGINS=https://blackworld729.blogspot.com` — আপনার আসল Blogger domain ব্যবহার করুন; path/trailing slash নয়। তারপর Bot restart করুন।
- `adminUids/{আপনার Firebase Auth UID}` মান `true` কিনা যাচাই করুন।
- Discord-এর পুরোনো Shop panel নতুন option না দেখালে Bot online আছে কি না, Bot-এর Send Messages/Read Message History/Manage Messages permissions আছে কি না, payment panel channel ID সঠিক কি না এবং startup/sync logs দেখুন।


## v1.5.5 — “API পৌঁছানো যায়নি” সমস্যার নির্ণয়

এই সংস্করণে Bot API-এর `/api/cpp/health` endpoint public, non-sensitive connection probe হিসেবে browser-কে response দেয়। এটি শুধু service/version এবং প্যানেলের origin allowlist-এ আছে কি না জানায়; account data বা credentials ফেরত দেয় না। Account lookup/update endpoint-এ verified Firebase Admin token এবং strict origin allowlist এখনও বাধ্যতামূলক।

### ধাপে ধাপে ঠিক করুন
1. ZIP থেকে `payment-reader-system/discord-bot/`-এর নতুন ফাইলগুলো আপনার Bot hosting-এ deploy করুন এবং dependencies install করে Bot restart/redeploy করুন। **শুধু Blogger HTML প্রকাশ করলে হবে না।**
2. Bot service-এর আসল HTTPS base URL বের করুন। যেমন `https://your-service.onrender.com`। URL-এ `/api/cpp/health`, অন্য path, শেষে slash, username/password বা query যোগ করবেন না।
3. browser-এ সরাসরি `https://YOUR-BOT-HOST/api/cpp/health` খুলুন। নতুন build-এ JSON-এ `ok: true`, `service: "rkbackles-cpp-bridge"`, `version: "1.5.5"` দেখা উচিত। `Cannot GET`, 404, অথবা পুরোনো version এলে সঠিক server/branch deploy হয়নি।
4. Blogger-এ C++ Account panel খুলে **Bot API HTTPS URL** ঘরে সেই base URL দিন, তারপর **Test API connection** চাপুন।
5. যদি status-এ “origin অনুমোদিত নয়” লেখা আসে, error-এ দেখানো origin হুবহু copy করে Bot host-এর environment variable `ADMIN_PANEL_ORIGINS`-এ দিন। উদাহরণ `ADMIN_PANEL_ORIGINS=https://blackworld729.blogspot.com`। নিজের প্যানেল আসলে অন্য Blogger domain-এ থাকলে সেটিই ব্যবহার করবেন। origin-এ page path বা শেষের `/` দেবেন না। একাধিক origin হলে comma দিয়ে আলাদা করুন।
6. Hosting dashboard থেকে Bot restart/redeploy করুন। তারপর Blogger panel refresh করে **Test API connection** আবার চাপুন। `Connected · API version 1.5.5` না দেখা পর্যন্ত Save account changes কাজ করবে না।
7. URL ঠিক, origin allowlisted এবং Bot v1.5.5 online—তবুও error থাকলে hosting logs-এ startup error দেখুন; browser Console/Network-এ `/api/cpp/health` response দেখুন। Secret, Discord token, service-account JSON, Firebase ID token বা password কাউকে পাঠাবেন না।

### Status কী বোঝায়
- **API connection successful / Connected:** base URL reachable এবং health probe ঠিক।
- **Bot সার্ভার চালু আছে, কিন্তু এই প্যানেলের origin অনুমোদিত নয়:** URL ঠিক, কিন্তু `ADMIN_PANEL_ORIGINS`-এ exact origin নেই বা Bot restart হয়নি।
- **API-তে network connection হয়নি:** ভুল host URL, server sleep/down, HTTPS/TLS সমস্যা, অথবা v1.5.5-এর আগে build deploy আছে।
- **Connected হলেও account operation unauthorized/forbidden:** C++ Accounts route-এ আলাদা admin permission দরকার; Firebase Console-এর `adminUids/{আপনার Firebase Auth UID}` boolean `true` হতে হবে। প্যানেলে সাইন-ইন করা account-এর UID-ই ব্যবহার করুন।

**সীমাবদ্ধতা:** এই patch source-level syntax/test checks-এ যাচাই হয়েছে। আপনার hosting URL, Blogger origin, Firebase production database বা live Discord server-এ access নেই, তাই live connection success দাবি করা হচ্ছে না।


## v1.5.6 — Admin Panel থেকে নতুন C++ account তৈরি
1. Render-এ নতুন ZIP-এর `discord-bot/index.js` ও `package.json` deploy করে Bot restart করুন। Health endpoint-এ `version: 1.5.6` নিশ্চিত করুন।
2. নতুন `admin-panel/blogger-admin-panel.html` ফাইলটি Netlify-তে `index.html` হিসেবে publish করুন।
3. Admin Panel-এ sign in করে `C++ Accounts` খুলুন। `New username`, `New password`, package, expiry days, lock mode ও status দিন।
4. `Create new account` চাপুন। Username আগেই থাকলে server conflict দেখাবে; existing account overwrite হবে না।
5. Admin-created account `paidAmount: 0` নিয়ে তৈরি হয় এবং payment approved বলে চিহ্নিত হয় না। এটি কেবল admin-authorized manual creation-এর জন্য; payment verification আলাদা ধাপ।
