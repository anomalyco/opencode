/**
 * Runs the collab schema migrations against the opencode SQLite database.
 * Called once at server startup after the main opencode migrations run.
 */
import { Database } from "@/storage/db"
import { assertUsableSessionSecret, encryptToken, isEncrypted } from "./crypto"

const SQL = `
  CREATE TABLE IF NOT EXISTS collab_session (
    id TEXT PRIMARY KEY,
    owner_github_id INTEGER NOT NULL,
    owner_github_login TEXT NOT NULL,
    name TEXT NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'submitted',
    queue_mode TEXT NOT NULL DEFAULT 'fifo',
    session_id TEXT,
    branch TEXT,
    init_status TEXT NOT NULL DEFAULT 'pending',
    init_error TEXT,
    preview_intent TEXT,
    preview_intent_at INTEGER,
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
    model TEXT,
    agent TEXT,
    variant TEXT,
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
  CREATE TABLE IF NOT EXISTS collab_reaction (
    suggestion_id TEXT NOT NULL REFERENCES collab_suggestion(id) ON DELETE CASCADE,
    voter_github_login TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (suggestion_id, voter_github_login, emoji)
  );
  CREATE INDEX IF NOT EXISTS collab_reaction_suggestion_idx ON collab_reaction(suggestion_id);
  CREATE TABLE IF NOT EXISTS collab_note (
    id TEXT PRIMARY KEY,
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    author_github_id INTEGER NOT NULL,
    author_github_login TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS collab_note_session_idx ON collab_note(collab_session_id);
  CREATE TABLE IF NOT EXISTS collab_invite (
    token TEXT PRIMARY KEY,
    collab_session_id TEXT NOT NULL REFERENCES collab_session(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at INTEGER,
    used_at INTEGER,
    used_by TEXT
  );
  CREATE TABLE IF NOT EXISTS collab_auth_session (
    token TEXT PRIMARY KEY,
    github_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    github_avatar_url TEXT NOT NULL DEFAULT '',
    github_access_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS collab_auth_session_login_idx ON collab_auth_session(github_login);
`

export function runCollabMigrations() {
  // ADR-0004 — refuse to start with a placeholder SESSION_SECRET in production.
  // The OPENCODE_ALLOW_UNAUTHENTICATED=1 escape hatch bypasses this for local
  // dev; everything else throws and the process exits.
  assertUsableSessionSecret(process.env["SESSION_SECRET"] ?? "")

  Database.use((db) => {
    db.$client.exec(SQL)

    // Backfill: add `branch` to collab_session for older deployments where
    // the table was created before this column existed.  SQLite has no
    // "ADD COLUMN IF NOT EXISTS", so we probe via PRAGMA table_info first.
    const cols = db.$client.prepare("PRAGMA table_info(collab_session)").all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === "branch")) {
      db.$client.exec("ALTER TABLE collab_session ADD COLUMN branch TEXT")
    }
    // init_status / init_error were added in the "fix/session" pass — gate
    // the iframe on explicit workspace readiness.  Legacy rows are by
    // definition already past initialization; backfill them as "ready" so
    // the new gate doesn't trap them in the placeholder.
    if (!cols.some((c) => c.name === "init_status")) {
      db.$client.exec("ALTER TABLE collab_session ADD COLUMN init_status TEXT NOT NULL DEFAULT 'ready'")
    }
    if (!cols.some((c) => c.name === "init_error")) {
      db.$client.exec("ALTER TABLE collab_session ADD COLUMN init_error TEXT")
    }

    // model / agent / variant on collab_suggestion — added by the model-pipeline
    // pass (commit f2a8c9026).  Originally shipped as an opencode-native Drizzle
    // migration at packages/opencode/migration/20260528033731_add_suggestion_model_agent_variant/
    // but that runs at DB-open BEFORE runCollabMigrations() creates the
    // collab_suggestion table — every fresh DB crashed with
    // "no such table: collab_suggestion" on boot.  Belongs in the collab
    // migrate pass, like every other collab-* schema change.
    const sugCols = db.$client.prepare("PRAGMA table_info(collab_suggestion)").all() as Array<{ name: string }>
    if (!sugCols.some((c) => c.name === "model")) {
      db.$client.exec("ALTER TABLE collab_suggestion ADD COLUMN model TEXT")
    }
    if (!sugCols.some((c) => c.name === "agent")) {
      db.$client.exec("ALTER TABLE collab_suggestion ADD COLUMN agent TEXT")
    }
    if (!sugCols.some((c) => c.name === "variant")) {
      db.$client.exec("ALTER TABLE collab_suggestion ADD COLUMN variant TEXT")
    }

    // preview_intent / preview_intent_at on collab_session — the Driver's
    // preview-launch wish persisted across container restart.  The launch
    // routes (router.ts) set these when the Driver clicks Launch and clear
    // them on Stop.  At boot, resumePreviewsOnBoot() reads the rows and
    // re-spawns the single most-recent launcher (ADR-0001 / preview-launcher
    // contract = at most ONE active preview process per container).
    // See plan: ~/.claude/plans/i-want-to-fork-crispy-sketch.md fix #3.
    if (!cols.some((c) => c.name === "preview_intent")) {
      db.$client.exec("ALTER TABLE collab_session ADD COLUMN preview_intent TEXT")
    }
    if (!cols.some((c) => c.name === "preview_intent_at")) {
      db.$client.exec("ALTER TABLE collab_session ADD COLUMN preview_intent_at INTEGER")
    }

    // Boot sweep: revert mid-flight LLM dispatches back to `approved` so the
    // newly-booted task's queue executor picks them up and re-runs them.  A
    // row sits in `in_flight` ONLY while the previous container had an open
    // `prompt_async` call mid-stream; once it returned successfully the
    // executor flips to `submitted`.  An ECS task replacement (or any other
    // process death) mid-dispatch is therefore directly observable here as a
    // surviving `in_flight` row.  Without this sweep, the Driver sees their
    // prompt acknowledged in the queue but no LLM response — silent loss.
    //
    // Idempotent (no-op if no rows match) and safe to re-run.  No backfill
    // needed because legacy rows never had `in_flight` as a state.
    const recovered = db.$client
      .prepare(`UPDATE collab_suggestion SET status = 'approved' WHERE status = 'in_flight'`)
      .run()
    // bun:sqlite RunResult exposes a `changes` number — log only when non-zero
    // to keep the boot log clean during normal startups.
    const changes = (recovered as { changes?: number }).changes ?? 0
    if (changes > 0) {
      console.log(`[collab.migrate] boot sweep: ${changes} in_flight prompt(s) → approved (will re-dispatch)`)
    }

    // ADR-0004 — one-shot re-encryption of legacy plaintext access tokens.
    // Idempotent: rows already `enc:v1:...` are skipped.  Rows that fail to
    // decrypt under the current key are NOT touched here — they're cleaned
    // up at read time by getSession() per the decrypt-failure policy.
    encryptLegacyAuthSessionTokens(db)
  })
}

/** Re-encrypt any `collab_auth_session.github_access_token` rows still in
 *  plaintext.  Batched at 1000 rows per pass so a huge backlog can't
 *  starve the rest of startup; falls through cleanly once no rows match. */
function encryptLegacyAuthSessionTokens(db: any) {
  const secret = process.env["SESSION_SECRET"] ?? ""
  let total = 0
  // Bound the loop defensively; ~1M rows is far beyond anything realistic.
  for (let i = 0; i < 1000; i++) {
    const rows = db.$client
      .prepare(`SELECT token, github_access_token FROM collab_auth_session LIMIT 1000`)
      .all() as Array<{ token: string; github_access_token: string }>
    const plaintext = rows.filter((r) => !isEncrypted(r.github_access_token))
    if (plaintext.length === 0) break
    const update = db.$client.prepare(
      `UPDATE collab_auth_session SET github_access_token = ? WHERE token = ?`,
    )
    const tx = db.$client.transaction((batch: Array<{ token: string; github_access_token: string }>) => {
      for (const r of batch) {
        update.run(encryptToken(r.github_access_token, secret), r.token)
      }
    })
    tx(plaintext)
    total += plaintext.length
    if (plaintext.length < 1000) break
  }
  if (total > 0) {
    console.log(`[collab.crypto] migrated ${total} plaintext auth-session token(s) → enc:v1`)
  }
}
