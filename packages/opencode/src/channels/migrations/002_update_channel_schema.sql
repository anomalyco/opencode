-- Migration 002: Update channel_config for plugin-based system
-- This migration:
-- 1. Removes the type constraint to allow any plugin type
-- 2. Makes webhook_url nullable (plugins may not use webhooks)
-- 3. Adds config column for plugin-specific configuration

-- Remove type constraint if it exists
-- (SQLite doesn't support ALTER COLUMN, so we need to recreate the table)

-- Step 1: Create new table with updated schema
CREATE TABLE IF NOT EXISTS channel_config_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  webhook_url TEXT DEFAULT '',
  config TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Step 2: Copy existing data
INSERT INTO channel_config_new (id, type, name, webhook_url, enabled, created_at, updated_at)
SELECT id, type, name, webhook_url, enabled, created_at, updated_at
FROM channel_config;

-- Step 3: Drop old table
DROP TABLE channel_config;

-- Step 4: Rename new table
ALTER TABLE channel_config_new RENAME TO channel_config;

-- Step 5: Recreate indexes if any existed
-- (Add index recreation here if needed)
