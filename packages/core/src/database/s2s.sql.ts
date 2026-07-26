// Drizzle schema declarations for the s2s_* tables.
//
// The s2s store (`packages/opencode/src/s2s/store.ts`) accesses these
// tables via raw `sql\`\`` queries — it does NOT use the Drizzle query
// builder — but the tables still need to appear in Drizzle's schema
// graph so the codegen pipeline in `packages/core/script/migration.ts`
// emits `CREATE TABLE` statements for them. Without a Drizzle definition,
// a fresh in-memory database (e.g. test setup) ends up running
// `schema.up(tx)` (which is just the Drizzle-derived full schema) and
// never creates the s2s tables. The TypeScript migration
// `20260616101412_s2s_tables` runs only on existing installs, where the
// upgrade path is "find the new migration id in the registry, run its
// `up`". Drizzle schema presence keeps both paths consistent.

import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core"

export const S2SInboxTable = sqliteTable(
  "s2s_inbox",
  {
    id: text().primaryKey(),
    target_session_id: text().notNull(),
    from_session_id: text(),
    from_slug: text(),
    capsule: text().notNull(),
    drained_at: integer(),
    time_created: integer().notNull(),
  },
  (table) => [index("s2s_inbox_target").on(table.target_session_id, table.drained_at)],
)

export const S2STokenTable = sqliteTable("s2s_token", {
  token: text().primaryKey(),
  inviter_session_id: text().notNull(),
  inviter_slug: text().notNull(),
  accepted_by: text(),
  accepted_at: integer(),
  created_at: integer().notNull(),
})

export const S2SAllowTable = sqliteTable(
  "s2s_allow",
  {
    session_id: text().notNull(),
    allowed_session_id: text().notNull(),
    established_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.allowed_session_id] })],
)
