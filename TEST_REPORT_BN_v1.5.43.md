# Test Report — v1.5.43

- Discord Bot automated tests: **48 passed, 0 failed**.
- `node --check discord-bot/index.js`: passed.
- `node --check discord-bot/live-studio-server.js`: passed.
- Admin Panel inline JavaScript `node --check`: passed.
- `discord-bot/package.json`, `firebase/database.rules.json`, and `firebase/database.rules.fragment.json`: valid JSON.

Automated checks cover unpinned Radar posts, ticket-aware channel locking, permission snapshot persistence before lock, live-end cleanup/restore wiring, Firebase closed-ticket archive wiring, archive safety fallback, and escaped/HTTPS-only rendering in Admin Panel.

**Not tested here:** actual permissions on the user's live Discord server, hosting deployment, real Firebase writes, or actual ticket-close interaction. Ensure Bot role permissions and Firebase rules are deployed before use.
