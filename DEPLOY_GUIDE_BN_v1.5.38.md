# RKBACKLES v1.5.38 Deployment Guide (বাংলা)

## A. InfinityFree — Admin Panel ও Invite Page

Upload these two files into the account's `htdocs/` root:
1. `index.html` — copied from `admin-panel/blogger-admin-panel.html`
2. `live-room.html` — copied from `discord-bot/public/live-room.html`

The invitation URL is generated on exactly this domain:
`https://admin-9x7v1.wuaze.com/live-room.html?invite=...`

The Live Room HTML currently uses `const BOT_API_BASE_URL='https://sbsx.onrender.com'`. If the deployed Bot uses another hostname, update that one constant before uploading the HTML. This URL is public API routing information, not a secret.

## B. Render — Discord Bot

Recommended Bot folder: `payment-reader-system/discord-bot/`
- Root Directory: `payment-reader-system/discord-bot` (or `discord-bot` if those files are merged into repo root)
- Build Command: `npm install`
- Start Command: `npm start`
- Node: `>=22.12.0`

Required Environment:
- `TOKEN` — Discord Bot token (private)
- `FIREBASE_CONFIG` and `FIREBASE_DB_URL` — current project configuration
- `ADMIN_PANEL_ORIGINS=https://admin-9x7v1.wuaze.com,https://liveuseradmin9x.blogspot.com` (both exact origins, comma-separated)
- `LIVEKIT_URL=wss://sabbir-ylq7x559.livekit.cloud` (use your actual LiveKit project URL)
- `LIVEKIT_API_KEY` — same LiveKit project API key
- `LIVEKIT_API_SECRET` — same LiveKit project API secret
- `LIVE_STUDIO_PUBLIC_BASE_URL=https://admin-9x7v1.wuaze.com`
- `LIVE_STUDIO_DEFAULT_DURATION_MINUTES=60`
- `LIVE_STUDIO_MAX_PARTICIPANTS=20`
- `LIVE_STUDIO_MAX_INVITE_USES=10000`
- `LIVE_STREAM_RADAR_PIN_ALL_TEXT_CHANNELS=true`

Never paste LiveKit API secret, Discord Bot token or service-account private key into HTML, the public repository or chat.

## C. Discord Bot permissions

The Bot needs access to eligible text/announcement channels: View Channel, Send Messages, Read Message History and Manage Messages/Pin Messages. For the Admin panel's Discord Voice member controls it also needs Mute Members, Deafen Members and Move Members permissions in those voice channels. The Discord Bot role must be high enough to act on the selected members. Errors are shown/logged if Discord denies an action.

The live announcement is posted in accessible text channels rather than mass-DMing every member. That avoids unrequested bulk direct messages. The same Bot-owned message is edited/pinned, not re-sent each time. When Live Studio ends, invite codes are invalidated, the LiveKit room is deleted, and Radar messages are unpinned/deleted where permissions allow.

## D. Admin Panel API setup

1. Open `https://admin-9x7v1.wuaze.com/` and sign in through Firebase.
2. Open C++ Accounts → Bot API HTTPS URL and enter `https://sbsx.onrender.com` (or the real Bot origin if different).
3. Press **Test API connection** and ensure it succeeds. The value is saved locally in the browser.
4. Firebase Authentication → Authorized domains must include `admin-9x7v1.wuaze.com`. Keep `adminUids/{your UID} = true` and existing Database rules.
5. Open **LIVE STREAM RADAR**, choose duration from 5–480 minutes, and press **Start Live Studio**.


## E. Blogger — public live status, no refresh

1. Open Blogger for `https://liveuseradmin9x.blogspot.com/` → **Layout** → **Add a Gadget** → **HTML/JavaScript**.
2. Open `RKBACKLES_Blogger_Live_Status_Widget_v1.5.38.html`, copy the complete contents, and paste into the gadget content box. Leave the title blank or set it to “Live”. Save and move the gadget where visitors should see the live card.
3. Confirm Render's `ADMIN_PANEL_ORIGINS` is exactly `https://admin-9x7v1.wuaze.com,https://liveuseradmin9x.blogspot.com` and redeploy/restart the Bot. Do not replace the live page's API URL unless the Bot uses a different HTTPS origin.
4. Open the Blogger site. The widget polls the Bot's read-only `/api/live-studio/public-status` endpoint every 5 seconds, so it updates without reloading. When a session starts, it shows LIVE NOW, countdown and an invite link; when the session ends, it hides the invite.
5. The public endpoint intentionally exposes only active status, public invite URL, start/end timestamps and duration. It does not expose participant names, room names, host tokens, or LiveKit secrets. Do not make Firebase `runtime` data public.

`liveuseradmin9x.blogspot.com` is the public live-status page; `admin-9x7v1.wuaze.com` remains the Admin Panel and the host for `live-room.html`. The Blogger widget is responsive for phone, tablet and desktop.


## F. Verify after deploy

- Open `https://sbsx.onrender.com/api/live-studio/route-health`; expect `configured: true` and version `1.5.38`.
- Start Studio and confirm Invite URL starts with `https://admin-9x7v1.wuaze.com/live-room.html?invite=`.
- Confirm the `LIVE STREAM RADAR` message appears pinned in text channels where the Bot has permission.
- Open invite in a private browser session; invalid/expired invites show the error and Back to Admin Panel link.
- Test microphone, screen share, one HD preset and fullscreen in two separate browsers/devices.
- Test channel mute/deafen/disconnect only in a test channel first.

## G. New v1.5.38 items
- Start Live Studio: the Bot profile activity switches to `🔴 LIVE NOW · Live Studio` and returns to the Admin Panel-configured activity after manual end or duration expiry. A Bot account cannot publish the same native local-app Rich Presence (RPC) as a regular Discord user; this is the supported Bot activity status.
- C++ Accounts: search the Existing username and load the account before editing. A blank New password keeps the current password; existing passwords are hashed and are never sent back to the Panel. To change it, enter a new 8–128 character password.
- Theme: use the Light/Dark button. The choice is saved locally in the browser.
- Purchase delivery: the user DM includes a link to the private order/support ticket. If DMs are closed, the private ticket shows a delivery warning.

## Security note
Browser code cannot be hidden completely by obfuscation. Never put the Discord token, LiveKit API secret, or Firebase service-account private key in HTML. Those belong in Render's environment variables; Firebase Authentication, API-side ID-token checks and Database Rules must enforce access.

## Safety / limitations

- Discord channels and members are displayed from current Bot cache/voice-state data; a Bot restart or missed gateway events may briefly affect the display before the next poll.
- The room is a LiveKit web room, not native Discord Go Live. A single Bot instance can only join one Discord voice channel in a guild at a time; this interface lists and can moderate all voice/stage channels but does not make one Bot join all of them simultaneously.
- The code has not been deployed to GitHub/Render/InfinityFree in this session. Local syntax/tests do not prove that private credentials, CORS, Discord permissions, and LiveKit project settings are valid in production.
