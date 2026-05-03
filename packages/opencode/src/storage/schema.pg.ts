import { pgTable, text, bigint, jsonb, index, primaryKey, integer } from "drizzle-orm/pg-core"
import { getDb } from "./db.pg"
import { eq, SQL } from "drizzle-orm"

export const Timestamps = {
  time_created: bigint({ mode: "number" }).notNull(),
  time_updated: bigint({ mode: "number" }).notNull(),
}

// Helper to get first row or undefined (replaces .get() from SQLite)
export async function first<T>(promise: Promise<T[]>): Promise<T | undefined> {
  const rows = await promise
  return rows[0]
}

export const ProjectTablePg = pgTable("project", {
  id: text().primaryKey(),
  tenant_user_id: text().notNull(),
  name: text(),
  icon_url: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: bigint({ mode: "number" }),
  commands: jsonb(),
})

export const SessionTablePg = pgTable(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTablePg.id, { onDelete: "cascade" }),
    workspace_id: text(),
    parent_id: text(),
    slug: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: jsonb(),
    revert: jsonb(),
    permission: jsonb(),
    ...Timestamps,
    time_compacting: bigint({ mode: "number" }),
    time_archived: bigint({ mode: "number" }),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTablePg = pgTable(
  "message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTablePg.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: jsonb().notNull(),
  },
  (table) => [index("message_session_idx").on(table.session_id)],
)

export const PartTablePg = pgTable(
  "part",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => MessageTablePg.id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    ...Timestamps,
    data: jsonb().notNull(),
  },
  (table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
)

export const TodoTablePg = pgTable(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTablePg.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: bigint({ mode: "number" }).notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTablePg = pgTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTablePg.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: jsonb().notNull(),
})

export const SessionShareTablePg = pgTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTablePg.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...Timestamps,
})

export const WorkspaceTablePg = pgTable(
  "workspace",
  {
    id: text().primaryKey(),
    branch: text(),
    project_id: text()
      .notNull()
      .references(() => ProjectTablePg.id, { onDelete: "cascade" }),
    type: text().notNull(),
    name: text(),
    directory: text(),
    extra: jsonb(),
  },
  (table) => [index("workspace_project_idx").on(table.project_id)],
)

export const AccountTablePg = pgTable("account", {
  id: text().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().notNull(),
  refresh_token: text().notNull(),
  token_expiry: bigint({ mode: "number" }),
  ...Timestamps,
})

export const AccountStateTablePg = pgTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text().references(() => AccountTablePg.id, { onDelete: "set null" }),
  active_org_id: text(),
})

export const ControlAccountTablePg = pgTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().notNull(),
    refresh_token: text().notNull(),
    token_expiry: bigint({ mode: "number" }),
    active: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)
