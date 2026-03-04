# @opencode-ai/telegram

Telegram bot integration for OpenCode. Allows you to supervise and interact with OpenCode agents directly from Telegram.

## Features

- **Output streaming**: See OpenCode tool executions and task progress in real-time
- **Prompt from Telegram**: Send messages to your OpenCode session directly from Telegram
- **Session management**: Create, list, abort, and share sessions
- **Command execution**: Run OpenCode commands (e.g. `/compact`, `/clear`) from Telegram
- **Diff viewing**: See file changes made by the agent
- **Access control**: Restrict bot access to specific Telegram chat IDs

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token

### 2. Configure Environment Variables

```bash
# Required
export TELEGRAM_BOT_TOKEN="your-bot-token-here"

# Optional: restrict access to specific chat IDs (comma-separated)
# Get your chat ID by messaging @userinfobot on Telegram
export TELEGRAM_ALLOWED_CHAT_IDS="123456789,987654321"
```

### 3. Run

```bash
bun run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and available commands |
| `/new` | Create a new OpenCode session |
| `/sessions` | List all active sessions |
| `/status` | Show current session status |
| `/abort` | Abort the current running session |
| `/diff` | Show file changes in the current session |
| `/share` | Share the current session (generates a URL) |
| `/cmd <command>` | Execute an OpenCode command (e.g. `/cmd /compact`) |
| `/help` | Show help message |

## Usage

Simply send any text message to the bot, and it will be forwarded as a prompt to OpenCode. The bot will:

1. Create a session automatically if none exists
2. Send your message to OpenCode
3. Return the response
4. Stream tool execution updates in real-time

## Security

Set `TELEGRAM_ALLOWED_CHAT_IDS` to restrict which Telegram users/groups can interact with the bot. If not set, the bot will accept messages from anyone.
