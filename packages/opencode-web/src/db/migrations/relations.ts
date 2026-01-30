import { relations } from "drizzle-orm/relations";
import { users, sessions, projects, messages, refreshTokens, tasks } from "./schema";

export const sessionsRelations = relations(sessions, ({one, many}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
	project: one(projects, {
		fields: [sessions.projectId],
		references: [projects.id]
	}),
	messages: many(messages),
	tasks: many(tasks),
}));

export const usersRelations = relations(users, ({many}) => ({
	sessions: many(sessions),
	projects: many(projects),
	refreshTokens: many(refreshTokens),
	tasks: many(tasks),
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	sessions: many(sessions),
	user: one(users, {
		fields: [projects.userId],
		references: [users.id]
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	session: one(sessions, {
		fields: [messages.sessionId],
		references: [sessions.id]
	}),
}));

export const refreshTokensRelations = relations(refreshTokens, ({one}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
}));

export const tasksRelations = relations(tasks, ({one}) => ({
	user: one(users, {
		fields: [tasks.userId],
		references: [users.id]
	}),
	session: one(sessions, {
		fields: [tasks.sessionId],
		references: [sessions.id]
	}),
}));