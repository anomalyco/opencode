# @opencode-ai/telegram

Telegram bot integration for opencode that creates per-chat sessions with streaming responses.

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Copy `.env.example` to `.env`:
   - `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
   - `OPENCODE_DIRECTORY` - (Optional) Directory for opencode to work in

## Usage

```bash
cd packages/telegram
cp .env.example .env
# Edit .env with your bot token
bun dev
```

The bot responds to messages in chats, creating separate opencode sessions for each chat+thread. Supports streaming replies, inline permission approval, and slash commands.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with setup instructions |
| `/help` | List all commands |
| `/sessions` | List active opencode sessions |
| `/abort` | Abort current agent loop |
| `/model` | Show or switch the current model |
| `/mode` | Show or switch the current mode |

## Architecture

Uses the same pattern as the Slack integration: `createOpencode()` spawns an opencode server, session map tracks chat+thread to opencode session mapping, and SSE events stream updates back to Telegram.
