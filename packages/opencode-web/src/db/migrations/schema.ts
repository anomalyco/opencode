import { pgTable, foreignKey, uuid, varchar, text, jsonb, timestamp, unique, integer, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const containerStatus = pgEnum("container_status", ['creating', 'running', 'stopping', 'stopped', 'error'])
export const taskStatus = pgEnum("task_status", ['pending', 'running', 'completed', 'failed', 'cancelled'])


export const sessions = pgTable("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	projectId: uuid("project_id").notNull(),
	opencodeSessionId: varchar("opencode_session_id", { length: 64 }),
	title: varchar({ length: 500 }),
	containerId: varchar("container_id", { length: 64 }),
	containerIp: varchar("container_ip", { length: 45 }),
	containerAuthToken: text("container_auth_token"),
	containerStatus: containerStatus("container_status").default('stopped'),
	lastModel: jsonb("last_model"),
	summary: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	archivedAt: timestamp("archived_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "sessions_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	opencodeMessageId: varchar("opencode_message_id", { length: 64 }),
	role: varchar({ length: 20 }).notNull(),
	content: text(),
	parts: jsonb().default([]),
	model: jsonb(),
	tokens: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "messages_session_id_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }),
	passwordHash: text("password_hash").notNull(),
	settings: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const projects = pgTable("projects", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	repositoryUrl: text("repository_url"),
	defaultBranch: varchar("default_branch", { length: 255 }).default('main'),
	workspaceVolume: varchar("workspace_volume", { length: 255 }),
	settings: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "projects_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "refresh_tokens_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const tasks = pgTable("tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	sessionId: uuid("session_id"),
	type: varchar({ length: 50 }).notNull(),
	status: taskStatus().default('pending').notNull(),
	input: jsonb().notNull(),
	output: jsonb(),
	error: text(),
	progress: integer().default(0),
	bullmqJobId: varchar("bullmq_job_id", { length: 100 }),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tasks_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "tasks_session_id_sessions_id_fk"
		}).onDelete("set null"),
]);
