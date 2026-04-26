import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { MultiRootWorkspaceID } from "./schema"

export const MultiRootWorkspaceTable = sqliteTable(
  "multi_root_workspace",
  {
    id: text().$type<MultiRootWorkspaceID>().primaryKey(),
    name: text().notNull(),
    file_path: text().notNull(),
    folders: text({ mode: "json" }).notNull().$type<{ path: string; name?: string }[]>(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("multi_root_workspace_name_idx").on(table.name),
    uniqueIndex("multi_root_workspace_file_path_idx").on(table.file_path),
  ],
)
