/**
 * Runs the collab schema migrations against the opencode SQLite database.
 * Called once at server startup after the main opencode migrations run.
 */
import { Database } from "@/storage/db"

const SQL = `
  CREATE TABLE IF NOT EXISTS collab_session (
    id TEXT PRIMARY KEY,
    owner_github_id INTEGER NOT NULL,
    owner_github_login TEXT NOT NULL,
    name TEXT NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'submitted',
    queue_mode TEXT NOT NULL DEFAULT 'fifo',
    session_id TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS collab_participant (
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    github_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    github_avatar_url TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    is_online INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (collab_session_id, github_id)
  );
  CREATE INDEX IF NOT EXISTS collab_participant_session_idx ON collab_participant(collab_session_id);
  CREATE TABLE IF NOT EXISTS collab_repo (
    id TEXT PRIMARY KEY,
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    repo_full_name TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS collab_repo_session_idx ON collab_repo(collab_session_id);
  CREATE TABLE IF NOT EXISTS collab_suggestion (
    id TEXT PRIMARY KEY,
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    author_github_id INTEGER NOT NULL,
    author_github_login TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    vote_score INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS collab_suggestion_session_idx ON collab_suggestion(collab_session_id);
  CREATE TABLE IF NOT EXISTS collab_vote (
    id TEXT PRIMARY KEY,
    suggestion_id TEXT NOT NULL REFERENCES collab_suggestion(id) ON DELETE CASCADE,
    voter_github_login TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (suggestion_id, voter_github_login)
  );
  CREATE INDEX IF NOT EXISTS collab_vote_suggestion_idx ON collab_vote(suggestion_id);
  CREATE TABLE IF NOT EXISTS collab_invite (
    token TEXT PRIMARY KEY,
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at INTEGER,
    used_at INTEGER,
    used_by TEXT
  );
`

export function runCollabMigrations() {
  Database.use((db) => {
    db.$client.exec(SQL)
  })
}
