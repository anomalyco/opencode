import { relations } from "drizzle-orm"
import { projects } from "./config"
import { sessions } from "./sessions"
import { messages } from "./messages"
import { messageParts } from "./messageParts"
import { providers, models } from "./providers"

// Project relations
export const projectsRelations = relations(projects, ({ many }) => ({
  sessions: many(sessions),
}))

// Session relations
export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  parent: one(sessions, {
    fields: [sessions.parentId],
    references: [sessions.id],
    relationName: "sessionHierarchy",
  }),
  children: many(sessions, {
    relationName: "sessionHierarchy",
  }),
  messages: many(messages),
}))

// Message relations
export const messagesRelations = relations(messages, ({ one, many }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
  parts: many(messageParts),
  provider: one(providers, {
    fields: [messages.providerId],
    references: [providers.id],
  }),
  model: one(models, {
    fields: [messages.modelId],
    references: [models.id],
  }),
}))

// Message part relations
export const messagePartsRelations = relations(messageParts, ({ one }) => ({
  session: one(sessions, {
    fields: [messageParts.sessionId],
    references: [sessions.id],
  }),
  message: one(messages, {
    fields: [messageParts.messageId],
    references: [messages.id],
  }),
}))

// Provider relations
export const providersRelations = relations(providers, ({ many }) => ({
  models: many(models),
  messages: many(messages),
}))

// Model relations
export const modelsRelations = relations(models, ({ one, many }) => ({
  provider: one(providers, {
    fields: [models.providerId],
    references: [providers.id],
  }),
  messages: many(messages),
}))
