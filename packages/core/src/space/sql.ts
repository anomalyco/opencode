import { sql } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Space } from "@opencode/schema/space"

/**
 * Client-defined state, separate from the server's own `kv` table: one row per key with the revision of its last
 * write. A deleted key keeps its row with a NULL value, so catch-up can report the deletion; each space keeps only its
 * newest tombstones, so its highest revision is never reissued.
 */
export const SpaceTable = sqliteTable(
  "space",
  {
    space: text().$type<Space.Name>().notNull(),
    key: text().$type<Space.Key>().notNull(),
    value: text().$type<Space.Value>(),
    revision: integer().$type<Space.Revision>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.space, table.key] }),
    index("space_revision_idx").on(table.space, table.revision),
    index("space_live_idx")
      .on(table.space, table.revision)
      .where(sql`${table.value} is not null`),
    // `value` makes counting and purging a space's tombstones read the index alone.
    index("space_tombstone_idx")
      .on(table.space, table.revision, table.value)
      .where(sql`${table.value} is null`),
  ],
)
