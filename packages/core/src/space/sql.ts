import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Space } from "@opencode/schema/space"

/**
 * Client-defined state, separate from the server's own `kv` table: one row per key with the revision of its last
 * write. A deleted key keeps its row with a NULL value, so catch-up can report the deletion and the space's highest
 * revision is never reissued.
 */
export const SpaceTable = sqliteTable(
  "space",
  {
    space: text().$type<Space.Name>().notNull(),
    key: text().$type<Space.Key>().notNull(),
    value: text({ mode: "json" }).$type<Space.Value>(),
    revision: integer().$type<Space.Revision>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.space, table.key] }),
    index("space_revision_idx").on(table.space, table.revision),
  ],
)
