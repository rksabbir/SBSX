# Discord Bot v1.5.28 — LIVE STREAM RADAR

`discord-bot/` contains the Node.js bot backend, Live Studio modules and the `public/` pages. Render's Root Directory should be `payment-reader-system/discord-bot` if this whole archive is placed at repository root, or simply `discord-bot` if the contents of `payment-reader-system` are merged directly into repository root.

Commands:
- Build: `npm install`
- Start: `npm start`
- Test: `npm test`

Read `../DEPLOY_INSTRUCTIONS_BN_v1.5.28.md` for LiveKit environment variables, Admin Panel origin, Discord pin permissions, and invite workflow.


## v1.5.33 Admin Session Fix
The current Blogger panel sends a Firebase ID token to protected Bot APIs. The Bot now verifies Firebase ID tokens server-side and checks `adminUids/{uid} = true` for every privileged request. Deploy the v1.5.33 Bot code, keep `ADMIN_PANEL_ORIGINS` set to the exact Blogger HTTPS origin, then sign in again.
