# Memory Tools Plugin

Cloud backup/restore plugin for OpenCode AgentMemory using Supabase.

## Features

- **Backup**: Push local memories to Supabase cloud storage
- **Restore**: Pull cloud memories back to local (merge with conflict resolution)
- **Sync Status**: View difference between local and cloud
- **Auto-Sync**: Scheduled backup at configurable intervals (5m, 15m, 1h, 1d)
- **Manual Mode**: Disable auto-sync and trigger manually

## Setup

### 1. Run Supabase Migration

In your Supabase SQL Editor, run the migration from `supabase/migrations/001_agent_memory.sql`:

```sql
-- Creates the agent_memory table with proper indexes
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  tags JSONB,
  strength INTEGER DEFAULT 100 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  time_created BIGINT NOT NULL,
  time_updated BIGINT NOT NULL
);
```

### 2. Configure Plugin

In your `opencode.json`:

```json
{
  "plugin": [
    ["@opencode-ai/memory-tools", {
      "supabaseUrl": "https://your-project.supabase.co",
      "supabaseKey": "your-service-role-key",
      "syncInterval": "5m"
    }]
  ]
}
```

Or use the built-in tool:

```
memory.configure <supabase-url> <service-role-key> [interval]
```

## Tools

| Tool | Description |
|------|-------------|
| `memory.configure` | Configure Supabase connection (url, key, interval) |
| `memory.backup` | Push all local memories to cloud |
| `memory.restore` | Pull cloud memories to local (merge) |
| `memory.status` | Show sync status (local count, cloud count, differences) |
| `memory.schedule` | Get or set auto-sync interval |

## Sync Interval

Format: `[number][unit]` where unit is `m` (minutes), `h` (hours), `d` (days)

Examples:
- `5m` - Every 5 minutes
- `15m` - Every 15 minutes
- `1h` - Every hour
- `1d` - Once daily
- `manual` - No auto-sync

## Conflict Resolution

When the same memory exists in both local and cloud:
- **Newest wins**: The version with the later `time_updated` timestamp is kept
- Both versions are preserved - no data is deleted

## Database Path

Local SQLite database is located at:
- **Windows**: `%APPDATA%\Local\opencode\opencode.db`
- **macOS**: `~/Library/Application Support/opencode/opencode.db`
- **Linux**: `~/.local/share/opencode/opencode.db`

Override with `OPENCODE_DB` environment variable.

## Security

- Uses Supabase service role key (PAT) for server-side operations
- RLS should be disabled for personal use (service role bypasses RLS)
- Config stored at `.opencode/memory-tools.json` in project directory