# OpenCode IM Integration

## Setup

### 1. Run init command

```bash
cd /path/to/opencode
opencode init
```

Follow the interactive prompts to configure your IM platform.

### 2. Edit configuration

The config file is created in your project root:

```
.opencode/opencode.json
```

Edit this file and add your bot token (and user ID for Telegram).

### 3. Start server

```bash
opencode serve
```

Then send messages to your bot to start using OpenCode!

## Features

### Media Support

- All media types: photo, document, audio, video, voice, video_note
- File size limit: 20MB
- MIME type whitelist
- Local storage with auto-cleanup (15 days)

### Session Management

- Auto-create session per chat
- Auto-compaction with notifications
- Project switching commands

### User Authentication

- Telegram user ID whitelist
- Configurable allowed users

### Commands

| Command                  | Description       |
| ------------------------ | ----------------- |
| `/switch_project <name>` | Switch to project |
| `/list_projects`         | List all projects |
| `/session_info`          | Show session info |
| `/help`                  | Show help         |

### Configuration

Configuration is saved in project directory (same as OpenCode):

```
.opencode/opencode.json
```

Config keys:

- `im.type` - Platform (telegram, slack, whatsapp, discord)
- `im.token` / `im.botToken` - Bot token
- `im.allowedUsers` - User ID whitelist (Telegram)
- `im.maxFileSize` - Max file size (default: 20MB)
- `im.allowedTypes` - MIME type whitelist
- `im.storagePath` - Local media storage path
- `im.cleanupDays` - Media retention in days (default: 15)
- `projects` - Named project paths

## Usage

1. Initialize: `opencode init`
2. Configure: Edit `.opencode/opencode.json` with your credentials
3. Start: `opencode serve`
4. Use: Send messages to your bot

## Switching Platforms

To use a different IM platform:

```bash
opencode init --platform slack
opencode init --platform telegram --token NEW_TOKEN
```
