CREATE TABLE IF NOT EXISTS curation_run_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('consolidation', 'evolution', 'decay', 'pattern')),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
  stats_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  memories_affected INTEGER NOT NULL DEFAULT 0,
  time_started INTEGER NOT NULL,
  time_completed INTEGER
);
