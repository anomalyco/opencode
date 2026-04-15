import { getPool } from "./db.pg";

export async function setupPostgresTables() {
	const pool = getPool();

	await pool.query(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      tenant_user_id TEXT NOT NULL,
      worktree TEXT NOT NULL,
      vcs TEXT,
      name TEXT,
      icon_url TEXT,
      icon_color TEXT,
      time_created BIGINT NOT NULL,
      time_updated BIGINT NOT NULL,
      time_initialized BIGINT,
      sandboxes JSONB NOT NULL DEFAULT '[]',
      commands JSONB
    )
  `);

	await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      workspace_id TEXT,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs JSONB,
      revert JSONB,
      permission JSONB,
      time_created BIGINT NOT NULL,
      time_updated BIGINT NOT NULL,
      time_compacting BIGINT,
      time_archived BIGINT
    )
  `);

	await pool.query(`
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      time_created BIGINT NOT NULL,
      time_updated BIGINT NOT NULL,
      data JSONB NOT NULL
    )
  `);

	await pool.query(`
    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      time_created BIGINT NOT NULL,
      time_updated BIGINT NOT NULL,
      data JSONB NOT NULL
    )
  `);

	console.log("PostgreSQL tables created successfully");
}
