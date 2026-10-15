# Test Report — RKBACKLES v1.5.45

- Automated Node test suite: **51 passed, 0 failed** (`npm test`).
- `node --check discord-bot/index.js`: passed.
- `node --check discord-bot/live-studio-server.js`: passed.
- `node --check discord-bot/test/live-studio-wiring.test.js`: passed.
- `npm run check`: passed.
- Firebase Database Rules JSON and Bot `package.json`: valid JSON.
- Tests include saved active-session recovery wiring, role overwrite targeting, ticket-aware temporary chat lock/restore, no Live Radar pins, pin cleanup, ticket archive backup, and existing payment/reader safeguards.

**Not integration-tested:** real Discord permission edits or unpin results, actual Firebase writes, a real LiveKit room restart/recovery, and Render deployment. These should be verified with a test Live after deployment.

**Important transition note:** automatic restart recovery applies to Live sessions started with v1.5.45 or later. After first deploying this release, start a fresh Live session once so its recovery record is saved.
