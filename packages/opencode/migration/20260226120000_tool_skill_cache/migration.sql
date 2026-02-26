-- Reference migration for cache module tables.
-- These tables are created directly in cache.db by src/cache/cache.ts.
-- This file documents schema intent and keeps history traceable.

CREATE TABLE IF NOT EXISTS tool_cache (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT,
  content_hash TEXT,
  is_l1 INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER,
  registered INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_cache (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT,
  content_hash TEXT,
  is_l1 INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER,
  registered INTEGER NOT NULL
);
