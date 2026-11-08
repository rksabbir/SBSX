# Changelog — v1.5.42

- Fixed lingering Discord system notifications created when the Bot pins its LIVE STREAM RADAR message.
- A scoped `messageCreate` handler now attempts to delete `CHANNEL_PINNED_MESSAGE` notices linked to a Bot-owned Radar post as soon as they arrive.
- Live-end cleanup scans recent channel history for remaining pin notices tied to the exact recorded Radar message ID, including cases where the main Radar post was already deleted.
- For old releases that removed the Radar index, cleanup can identify Bot-originated pin notices even if Discord omits the message reference. This bot only pins its Live Stream Radar messages; other members' pin notices are left alone.
- If message-history access or deletion fails, cleanup retains the index when possible and retries; failures are logged.
- Existing payment, ticket, Reader, account and Blogger Live Room files are preserved.
