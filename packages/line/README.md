# @opencode-ai/line

LINE Messaging API integration for OpenCode. Send coding prompts to OpenCode through LINE chat.

## Setup

1. Create a LINE Messaging API channel at https://developers.line.biz/console/
2. In the channel settings:
   - Enable "Use webhook"
   - Issue a "Channel access token (long-lived)"
   - Note the "Channel secret"
3. Set environment variables in `.env`:
   - `LINE_CHANNEL_ACCESS_TOKEN` - Channel access token
   - `LINE_CHANNEL_SECRET` - Channel secret
   - `PORT` - Webhook port (default: 3000)

## Usage

```bash
# Copy and edit env file
cp .env.example .env

# Start the bot
bun dev
```

The bot starts an OpenCode server internally and listens for LINE webhook events.

### Webhook URL

Set the webhook URL in LINE Developer Console:
- Local development: Use ngrok (`ngrok http 3000`) and set `https://xxx.ngrok.io/webhook`
- Production: `https://your-domain.com/webhook`

### Commands

- Send any text message to start coding
- `/new` - Start a new coding session
- `/abort` - Cancel the current prompt
- `/sessions` - Show active session info

### How it works

Each LINE user gets their own OpenCode session. Messages are forwarded to the AI coding agent, and responses are sent back through LINE. Tool updates (file edits, bash commands) are sent as real-time notifications.
