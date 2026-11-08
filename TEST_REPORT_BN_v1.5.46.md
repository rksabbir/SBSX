# RKBACKLES v1.5.46 — Test Report

- Automated tests: **59 passed, 0 failed**.
- JavaScript syntax checks: `discord-bot/live-studio-server.js`, `discord-bot/role-permissions.js`, `discord-bot/test/role-permissions.test.js`, `discord-bot/test/role-permissions-wiring.test.js` pass.
- Admin Panel inline JavaScript syntax parsed by Node without syntax errors.
- New tests verify: AI plan allowlist filtering, omitted/invalid outputs defaulting to `keep`, role overwrite editing only for explicit allow/deny states, restoration of prior allow/deny/inherit state, all permission routes requiring Firebase admin verification, approval-before-apply wiring, API key host-only documentation, and backup/revert UI wiring.
- ZIP integrity and presence of v1.5.46 feature files are checked during package creation.

**Not performed:** This environment did not connect to the user's live Discord server, Firebase project, Render deployment or OpenAI account. Therefore real API calls, live permission overwrites and live revert still need deployment validation.
