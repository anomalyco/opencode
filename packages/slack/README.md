# @opencode-ai/slack

Slack bot integration for opencode that creates threaded conversations.

## Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode
3. Enable Event Subscriptions and add these Bot Events:
   - `message.channels`
   - `message.groups`
   - `message.im` (optional, for direct messages)
4. Add the following OAuth scopes:
   - `chat:write`
   - `app_mentions:read`
   - `channels:history`
   - `groups:history`
5. Install the app to your workspace
6. Reinstall the app if you change scopes or subscribed events
7. Set environment variables in `.env`:
   - `SLACK_BOT_TOKEN` - Bot User OAuth Token
   - `SLACK_SIGNING_SECRET` - Signing Secret from Basic Information
   - `SLACK_APP_TOKEN` - App-Level Token from Basic Information

## Usage

```bash
# Edit .env with your Slack app credentials
bun dev
```

Invite the bot to a channel before testing it, for example with `/invite @opencode`.

The bot will respond to messages in channels where it's added, creating separate opencode sessions for each thread.
