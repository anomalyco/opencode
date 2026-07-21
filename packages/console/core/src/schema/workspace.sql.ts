import { json, primaryKey, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { timestamps, ulid } from "../drizzle/types"
import type { ModelAccess } from "../model-access"

export const WorkspaceTable = mysqlTable(
  "workspace",
  {
    id: ulid("id").notNull().primaryKey(),
    slug: varchar("slug", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    region: json("region").$type<("us" | "eu" | "sg" | "cn")[]>(),
    blocked_model_providers: json().$type<ModelAccess.Provider[]>(),
    ...timestamps,
  },
  (table) => [uniqueIndex("slug").on(table.slug)],
)

export function workspaceIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.workspaceID, table.id],
    }),
  ]
}
