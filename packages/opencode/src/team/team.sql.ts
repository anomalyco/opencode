import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { TeamID, TeamTaskID, MemoryID } from "./schema"
import type { SessionID } from "../session/schema"
import type { ProjectID } from "../project/schema"

export const TeamTable = sqliteTable(
  "team",
  {
    id: text().$type<TeamID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    status: text({ enum: ["active", "disbanded"] })
      .notNull()
      .default("active"),
    ...Timestamps,
  },
  (table) => [index("team_session_idx").on(table.session_id)],
)

export const TeamMemberTable = sqliteTable(
  "team_member",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    team_id: text()
      .$type<TeamID>()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent: text().notNull(),
    role: text({ enum: ["lead", "member"] }).notNull(),
    status: text({ enum: ["active", "completed", "failed", "cancelled"] })
      .notNull()
      .default("active"),
    ...Timestamps,
  },
  (table) => [
    index("team_member_team_idx").on(table.team_id),
    index("team_member_session_idx").on(table.session_id),
    uniqueIndex("team_member_team_agent_idx").on(table.team_id, table.agent),
  ],
)

export const TeamTaskTable = sqliteTable(
  "team_task",
  {
    id: text().$type<TeamTaskID>().primaryKey(),
    team_id: text()
      .$type<TeamID>()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    description: text(),
    owner: text(),
    status: text({ enum: ["pending", "in_progress", "completed", "failed"] })
      .notNull()
      .default("pending"),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [index("team_task_team_idx").on(table.team_id)],
)

export const AgentMemoryTable = sqliteTable(
  "agent_memory",
  {
    id: text().$type<MemoryID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    agent: text().notNull(),
    content: text().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("agent_memory_project_agent_idx").on(table.project_id, table.agent)],
)
