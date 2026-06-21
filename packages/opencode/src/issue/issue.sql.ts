import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const IssueTable = sqliteTable(
  "issue",
  {
    id: text().$type<string>().primaryKey(),
    directory: text().notNull(),
    parent_id: text(),
    level: integer().notNull().default(0),
    title: text().notNull().default(""),
    content: text().notNull(),
    description: text().notNull().default(""),
    status: text().notNull().default("backlog"),
    priority: text().notNull().default("none"),
    labels: text().notNull().default("[]"),
    due_date: text(),
    assignee_id: text(),
    linear_issue_id: text(),
    linear_team_id: text(),
    linear_project_id: text(),
    position: integer().notNull(),
    last_pushed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("issue_directory_idx").on(table.directory),
    index("issue_parent_id_idx").on(table.parent_id),
    index("issue_linear_issue_id_idx").on(table.linear_issue_id),
  ],
)

export type IssueRow = typeof IssueTable.$inferSelect
export type NewIssueRow = typeof IssueTable.$inferInsert
