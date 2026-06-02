CREATE TABLE IF NOT EXISTS channel_config (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('slack', 'discord')),
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
