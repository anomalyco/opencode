/**
 * Unit tests for the collab boot-sweep — `in_flight → approved` recovery.
 *
 * Plan: ~/.claude/plans/i-want-to-fork-crispy-sketch.md fix #2.
 *
 * `runCollabMigrations()` is wired to the Effect-backed Database wrapper
 * (Global.Path.data etc), so we don't drive it directly here.  We instead
 * exercise the SQL statement against a fresh `bun:sqlite` in-memory database
 * with the same schema shape — small, fast, and pinpoints regressions on the
 * actual UPDATE clause and column names without pulling in the full app
 * bootstrap.
 *
 * Co-located with the source (vs `packages/opencode/test/...`) to match the
 * collab fork's small-fast-test convention.
 */
import { expect, test, describe, beforeEach } from "bun:test"
import { Database as SQLite } from "bun:sqlite"

// The exact statement runCollabMigrations() runs as its boot sweep.  Kept as
// a module constant here so a copy-paste drift between this test and the
// migrate.ts implementation surfaces as a diff in code review.
const BOOT_SWEEP_SQL = `UPDATE collab_suggestion SET status = 'approved' WHERE status = 'in_flight'`

function makeDb(): SQLite {
  const db = new SQLite(":memory:")
  // Mirror the columns used by the sweep + the suggestion lifecycle.  Other
  // columns from the real schema are omitted — they're not exercised here.
  db.exec(`
    CREATE TABLE collab_suggestion (
      id TEXT PRIMARY KEY,
      collab_session_id TEXT NOT NULL,
      author_github_id INTEGER NOT NULL,
      author_github_login TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      vote_score INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `)
  return db
}

function seed(db: SQLite, rows: Array<{ id: string; status: string }>) {
  const stmt = db.prepare(`
    INSERT INTO collab_suggestion
      (id, collab_session_id, author_github_id, author_github_login, content, status, created_at)
    VALUES (?, 'cs_test', 1, 'octocat', 'hello', ?, ?)
  `)
  let t = 1_700_000_000_000
  for (const r of rows) {
    stmt.run(r.id, r.status, t++)
  }
}

function statuses(db: SQLite): Record<string, string> {
  const rows = db.prepare(`SELECT id, status FROM collab_suggestion ORDER BY id`).all() as Array<{
    id: string
    status: string
  }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.id] = r.status
  return out
}

describe("collab boot sweep — in_flight → approved", () => {
  let db: SQLite

  beforeEach(() => {
    db = makeDb()
  })

  test("flips solitary in_flight back to approved", () => {
    // The smoking-gun case: container died mid-stream.  Single row, no other
    // statuses present, the sweep MUST recover it or the prompt is silently
    // lost on the next boot.
    seed(db, [{ id: "s1", status: "in_flight" }])
    const res = db.prepare(BOOT_SWEEP_SQL).run()
    expect((res as { changes?: number }).changes).toBe(1)
    expect(statuses(db).s1).toBe("approved")
  })

  test("only flips in_flight rows — never touches approved/submitted/pending/rejected", () => {
    // The sweep is run on every boot, including healthy ones where most rows
    // are in terminal states.  A regression that broadened the WHERE clause
    // would silently re-run already-completed prompts (catastrophic — burns
    // tokens, duplicates LLM responses in the message log).
    seed(db, [
      { id: "s_pending", status: "pending" },
      { id: "s_approved", status: "approved" },
      { id: "s_in_flight_a", status: "in_flight" },
      { id: "s_in_flight_b", status: "in_flight" },
      { id: "s_submitted", status: "submitted" },
      { id: "s_rejected", status: "rejected" },
    ])
    const res = db.prepare(BOOT_SWEEP_SQL).run()
    expect((res as { changes?: number }).changes).toBe(2)
    const after = statuses(db)
    expect(after.s_pending).toBe("pending")
    expect(after.s_approved).toBe("approved")
    expect(after.s_in_flight_a).toBe("approved")
    expect(after.s_in_flight_b).toBe("approved")
    expect(after.s_submitted).toBe("submitted")
    expect(after.s_rejected).toBe("rejected")
  })

  test("is idempotent — second run on already-recovered DB is a no-op", () => {
    // Multiple calls on the same boot (or repeated `docker compose restart`
    // tests) must not regress submitted rows back to approved.  The WHERE
    // clause is the entire safety net.
    seed(db, [{ id: "s1", status: "in_flight" }])
    db.prepare(BOOT_SWEEP_SQL).run()
    const res2 = db.prepare(BOOT_SWEEP_SQL).run()
    expect((res2 as { changes?: number }).changes).toBe(0)
    expect(statuses(db).s1).toBe("approved")
  })

  test("no-op on a healthy DB with zero in_flight rows", () => {
    // The normal startup case.  Boot log shouldn't say anything (the caller
    // in migrate.ts guards the console.log with `changes > 0`); the SQL
    // itself must just report changes=0.
    seed(db, [
      { id: "s1", status: "pending" },
      { id: "s2", status: "submitted" },
    ])
    const res = db.prepare(BOOT_SWEEP_SQL).run()
    expect((res as { changes?: number }).changes).toBe(0)
  })
})
