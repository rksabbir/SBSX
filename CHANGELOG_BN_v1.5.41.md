# Changelog v1.5.41

- Fixed a race condition where live Radar pin cleanup could be skipped while another pin/edit task was busy.
- Cleanup requests remain pending until cleanup succeeds; failed deletes are logged and retried by the Radar refresh loop.
- Cleanup now checks indexed channels even when uncached and searches pinned/recent bot-owned LIVE STREAM RADAR posts if a stored message ID is stale.
- Live end unpins and deletes the Bot-owned Radar message, then removes its Firebase index only after cleanup succeeds.
- Blogger root Live Room URL from v1.5.40 remains unchanged: https://liveuseradmin9x.blogspot.com/?invite=...
