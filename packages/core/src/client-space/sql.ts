import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { ClientKV } from "@opencode/schema/client-kv"

/**
 * Client-defined state, separate from the server's own `kv` table: one row per key with the revision of its last
 * write. A deleted key keeps its row with a NULL value, so catch-up can report the deletion and the space's highest
 * revision is never reissued.
 */
export const ClientSpaceTable = sqliteTable(
  "client_space",
  {
    space: text().$type<ClientKV.Space>().notNull(),
    key: text().$type<ClientKV.Key>().notNull(),
    value: text({ mode: "json" }).$type<ClientKV.Value>(),
    revision: integer().$type<ClientKV.Revision>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.space, table.key] }),
    index("client_space_revision_idx").on(table.space, table.revision),
  ],
)
