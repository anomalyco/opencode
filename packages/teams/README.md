# @opencode-ai/teams

Microsoft Teams bot integration for opencode that creates one opencode session per personal chat.

## Setup

1. Register a Microsoft Entra app for your bot
2. Create an Azure Bot resource that uses that app registration
3. Enable the Teams channel on the bot resource
4. Set the messaging endpoint to `https://<your-tunnel>/api/messages`
5. Copy `.env.example` to `.env` and fill in your bot credentials
6. Update `appManifest/manifest.json`
   - replace `__TEAMS_APP_ID__` with your Teams app id
   - replace `__TEAMS_DOMAIN__` with your tunnel hostname, for example `12345.devtunnels.ms`
7. Zip the files inside `appManifest/` and sideload them into Teams

## Usage

```bash
bun dev
```

For local testing, expose port `3978` with a public HTTPS tunnel such as `devtunnel` or `ngrok`.

The bot exposes:

- `POST /api/messages` for Teams activities
- `GET /health` for a quick local health check

The current v1 behavior matches the Slack integration closely:

- one personal Teams chat maps to one opencode session
- the mapping is kept in memory
- the shared opencode session URL is posted when the session is first created
- completed tool calls are posted back as short follow-up messages
