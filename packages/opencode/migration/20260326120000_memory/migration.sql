CREATE TABLE IF NOT EXISTS memory (
  session_id TEXT PRIMARY KEY,
  project_dir TEXT NOT NULL,
  title TEXT,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  session_id UNINDEXED,
  project_dir,
  title,
  summary,
  content='memory',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, session_id, project_dir, title, summary)
  VALUES (new.rowid, new.session_id, new.project_dir, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, session_id, project_dir, title, summary)
  VALUES('delete', old.rowid, old.session_id, old.project_dir, old.title, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, session_id, project_dir, title, summary)
  VALUES('delete', old.rowid, old.session_id, old.project_dir, old.title, old.summary);
  INSERT INTO memory_fts(rowid, session_id, project_dir, title, summary)
  VALUES (new.rowid, new.session_id, new.project_dir, new.title, new.summary);
END;
