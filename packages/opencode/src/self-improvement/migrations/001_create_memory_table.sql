CREATE TABLE IF NOT EXISTS self_improvement_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    workspace_id TEXT,
    type TEXT NOT NULL,
    layer TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.8,
    access_count INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    time_created INTEGER NOT NULL,
    time_last_accessed INTEGER NOT NULL,
    time_last_evolved INTEGER,
    heartbeat_at INTEGER
);
