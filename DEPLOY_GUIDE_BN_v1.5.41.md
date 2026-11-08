# Deploy Guide (Bangla) — v1.5.41

1. Replace the deployed Bot source with the contents of `discord-bot/` from the v1.5.41 package, or deploy the full system ZIP.
2. On Render, use the same existing Root Directory and commands (`npm install`, `npm start`) and keep existing Environment Variables/secrets.
3. Redeploy the service. Do not paste Discord/Firebase/LiveKit secrets into HTML or chat.
4. In Discord, confirm the Bot has View Channel, Send Messages, Read Message History, Manage Messages (pin/unpin), and permission to delete its own messages in each intended channel.
5. Start a short test Live, verify a LIVE STREAM RADAR message is posted and pinned, then end the Live. Confirm the bot message disappears from the channel and the Pins list.
6. If a message remains, check Render logs for `Radar unpin failed`, `Live Stream Radar cleanup failed`, or missing channel permissions. The cleanup loop now keeps retrying rather than clearing its pending flag on a busy run.

Blogger live invite URL remains `https://liveuseradmin9x.blogspot.com/?invite=...`.
