import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, pgEnum } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

// Enums
export const taskStatusEnum = pgEnum("task_status", ["pending", "running", "completed", "failed", "cancelled"])
export const containerStatusEnum = pgEnum("container_status", ["creating", "running", "stopping", "stopped", "error"])

// Users table
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

// Projects table
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  repositoryUrl: text("repository_url"),
  defaultBranch: varchar("default_branch", { length: 255 }).default("main"),
  workspaceVolume: varchar("workspace_volume", { length: 255 }),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

// Sessions table
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  opencodeSessionId: varchar("opencode_session_id", { length: 64 }),
  title: varchar("title", { length: 500 }),
  containerId: varchar("container_id", { length: 64 }),
  containerIp: varchar("container_ip", { length: 45 }),
  containerAuthToken: text("container_auth_token"),
  containerStatus: containerStatusEnum("container_status").default("stopped"),
  lastModel: jsonb("last_model"),
  summary: jsonb("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
})

// Messages table
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  opencodeMessageId: varchar("opencode_message_id", { length: 64 }),
  role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant'
  content: text("content"),
  parts: jsonb("parts").default([]),
  model: jsonb("model"),
  tokens: jsonb("tokens"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// Tasks table
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  type: varchar("type", { length: 50 }).notNull(), // 'prompt', 'command', 'clone_repo'
  status: taskStatusEnum("status").default("pending").notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  error: text("error"),
  progress: integer("progress").default(0),
  bullmqJobId: varchar("bullmq_job_id", { length: 100 }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// Refresh tokens table
export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  sessions: many(sessions),
  tasks: many(tasks),
  refreshTokens: many(refreshTokens),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  sessions: many(sessions),
}))

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
  tasks: many(tasks),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  user: one(users, {
    fields: [tasks.userId],
    references: [users.id],
  }),
  session: one(sessions, {
    fields: [tasks.sessionId],
    references: [sessions.id],
  }),
}))

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}))

// Type exports
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
