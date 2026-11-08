# Test Report — v1.5.42

- Node test suite: **45 passed, 0 failed** (`npm test`).
- Unit checks cover Discord `CHANNEL_PINNED_MESSAGE` type (6), extracting reference IDs, matching only Radar target IDs, fallback detection when reference/index is missing, and excluding normal/other users' pin notices.
- Wiring checks cover real-time auto-delete and live-end fallback cleanup, including retaining cleanup index when notice removal fails.
- `node --check` passed for `index.js`, `live-studio-server.js`, and `live-studio-core.js`.
- Blogger Theme XML parsed successfully.
- Actual Discord API behavior still requires deploy verification with `Manage Messages` and `Read Message History` permissions.
