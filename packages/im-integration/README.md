# OpenCode IM Integration

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

- `/switch_project <name>` - Switch to project
- `/list_projects` - List all projects
- `/session_info` - Show session info
- `/help` - Show help

### Configuration

See `.config/opencode/opencode.json` for configuration options.
