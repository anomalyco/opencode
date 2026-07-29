import { index, integer, primaryKey, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sqliteTable } from "drizzle-orm/sqlite-core"
import type { Team } from "@opencode-ai/schema"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"

export const TeamTable = sqliteTable(
  "team",
  {
    id: text().$type<Team.ID>().primaryKey(),
    name: text().notNull(),
    lead_session_id: text()
      .$type<Team.Info["leadSessionID"]>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text().$type<Team.Status>().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("team_lead_session_idx").on(table.lead_session_id)],
)

export const TeamMemberTable = sqliteTable(
  "team_member",
  {
    team_id: text()
      .$type<Team.ID>()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    session_id: text()
      .$type<Team.Member["sessionID"]>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent: text().$type<Team.Member["agent"]>().notNull(),
    model: text({ mode: "json" }).$type<Team.Member["model"]>().notNull(),
    role: text().$type<Team.Member["role"]>().notNull(),
    permission: text().$type<Team.PermissionProfile>().notNull(),
    status: text().$type<Team.MemberStatus>().notNull(),
    current_task_id: text().$type<Team.TaskID>(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.team_id, table.name] }),
    uniqueIndex("team_member_session_idx").on(table.session_id),
    index("team_member_team_status_idx").on(table.team_id, table.status),
  ],
)

export const TeamMessageTable = sqliteTable(
  "team_message",
  {
    id: text().$type<Team.MessageID>().primaryKey(),
    team_id: text()
      .$type<Team.ID>()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    from_name: text().notNull(),
    to_name: text().notNull(),
    body: text().notNull(),
    delivered: integer({ mode: "boolean" }).notNull().default(false),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_delivered: integer(),
  },
  (table) => [
    index("team_message_recipient_idx").on(table.team_id, table.to_name, table.delivered, table.time_created),
  ],
)

export const TeamTaskTable = sqliteTable(
  "team_task",
  {
    id: text().$type<Team.TaskID>().primaryKey(),
    team_id: text()
      .$type<Team.ID>()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull(),
    status: text().$type<Team.TaskStatus>().notNull(),
    assignee: text(),
    dependencies: text({ mode: "json" }).$type<Team.TaskID[]>().notNull(),
    ...Timestamps,
  },
  (table) => [index("team_task_team_status_idx").on(table.team_id, table.status)],
)
