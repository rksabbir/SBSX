# Test Report — RKBACKLES v1.5.47

- Node test suite: **71 passed, 0 failed**.
- `node --check discord-bot/index.js`: pass.
- `node --check discord-bot/live-studio-server.js`: pass.
- Embedded Admin Panel JavaScript `node --check`: pass.
- Firebase database rules JSON parse: pass.
- Release ZIP CRC/integrity checks: run during packaging.

Coverage includes checkout/security regression tests, Live Radar pin/permission behavior, session recovery, ticket archive, reviewed AI role permission plans/revert, FAQ/rule/event normalization, onboarding/self-role allowlists, authenticated AI keyword automation plan/apply, suggestion status moderation/audit, and Admin Panel configuration wiring.

**Not covered by this local suite:** a live Discord guild, production Firebase rules, actual hierarchy/permission effects, LiveKit connectivity, OpenAI key/quota, or production hosting restart. A staged end-to-end smoke test is required before deploying to a live server.
