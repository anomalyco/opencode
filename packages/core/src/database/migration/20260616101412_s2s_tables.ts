// Session-to-Session — Task 2 (store tables).
//
// Three tables backing the s2s store module in
// `packages/opencode/src/s2s/store.ts`:
//
//   s2s_inbox   — durable cross-process mailbox. A target session ID drains
//                rows from this table by atomically marking `drained_at`.
//                The `drained_at IS NULL` guard inside the store's
//                UPDATE…RETURNING claim is the cross-process double-claim
//                protection: two concurrent drains racing on the same row
//                will see exactly one claim succeed (Bun's SQLite WAL
//                serializes writers, see Task 0's WAL sanity note in
//                `20260616095854_session_slug_unique.ts`).
//   s2s_token   — single-use invitation tokens issued by a session and
//                consumed once by a joining session. `accepted_by` flips
//                from NULL → session-id atomically; a NULL guard in the
//                store's claim makes double-acceptance impossible.
//   s2s_allow   — directional session-pair allowlist. Composite PK
//                (session_id, allowed_session_id) makes "is X allowed to
//                talk to Y?" a single SELECT; the PK is naturally
//                directional so we don't need an extra index.
//
// The Drizzle schema mirror of these tables lives in
// `packages/core/src/database/s2s.sql.ts` so the codegen pipeline in
// `script/migration.ts` keeps `schema.gen.ts` in sync — without that
// mirror, a fresh-in-memory database (e.g. test setup) would run
// `schema.up(tx)` (the Drizzle-derived full schema) and never create the
// s2s tables. The TypeScript migration is what runs on existing installs
// when the `applyOnly` loop encounters the new id.

import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260616101412_s2s_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE s2s_inbox (
          id TEXT PRIMARY KEY,
          target_session_id TEXT NOT NULL,
          from_session_id TEXT,
          from_slug TEXT,
          capsule TEXT NOT NULL,
          drained_at INTEGER,
          time_created INTEGER NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX s2s_inbox_target ON s2s_inbox (target_session_id, drained_at);`)
      yield* tx.run(`
        CREATE TABLE s2s_token (
          token TEXT PRIMARY KEY,
          inviter_session_id TEXT NOT NULL,
          inviter_slug TEXT NOT NULL,
          accepted_by TEXT,
          accepted_at INTEGER,
          created_at INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE s2s_allow (
          session_id TEXT NOT NULL,
          allowed_session_id TEXT NOT NULL,
          established_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, allowed_session_id)
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
