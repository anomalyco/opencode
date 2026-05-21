import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Session } from "."

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<Session.ID>().primaryKey(),
    project_id: text().notNull(),
    workspace_id: text(),
    parent_id: text().$type<Session.ID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    path: text(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: "json" }),
    permission: text({ mode: "json" }),
    agent: text(),
    model: text({ mode: "json" }).$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)
