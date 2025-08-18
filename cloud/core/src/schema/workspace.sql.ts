import { primaryKey, foreignKey, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { timestamps, ulid } from "../drizzle/types"

export const WorkspaceTable = pgTable(
  "workspace",
  {
    id: ulid("id").notNull().primaryKey(),
    slug: varchar("slug", { length: 255 }),
    name: varchar("name", { length: 255 }),
    ...timestamps,
  },
  (table) => [uniqueIndex("slug").on(table.slug)],
)

export function workspaceIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.workspaceID, table.id],
    }),
    foreignKey({
      foreignColumns: [WorkspaceTable.id],
      columns: [table.workspaceID],
    }),
  ]
}
