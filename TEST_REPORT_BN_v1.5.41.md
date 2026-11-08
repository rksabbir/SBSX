# Test Report v1.5.41

- `node --check live-studio-server.js`: PASS
- `npm test`: 43 passed, 0 failed
- Regression coverage: busy-pin cleanup race, stale pin index fallback, unpin/delete order, and pending cleanup retention.
- Live Discord server permission behavior was not exercised in production. Bot needs View Channel, Read Message History, Manage Messages (for unpin), and Manage Messages/Delete Messages permission to clean up its posts.
