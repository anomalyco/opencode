import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const UserProfileTable = sqliteTable("zero_user_profile", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  timezone: text("timezone"),
  preferences: text("preferences"),
  bio: text("bio"),
  facts: text("facts"),
  ...Timestamps,
})

export const PersonalNotesTable = sqliteTable("zero_personal_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags"),
  folder: text("folder"),
  pinned: integer("pinned"),
  ...Timestamps,
})

export const PersonalRemindersTable = sqliteTable("zero_personal_reminders", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  due_at: integer("due_at"),
  remind_at: integer("remind_at"),
  status: text("status"),
  priority: text("priority"),
  category: text("category"),
  recurring: text("recurring"),
  ...Timestamps,
})

export const PersonalEventsTable = sqliteTable("zero_personal_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  start_at: integer("start_at").notNull(),
  end_at: integer("end_at"),
  all_day: integer("all_day"),
  recurring: text("recurring"),
  source: text("source"),
  source_id: text("source_id"),
  ...Timestamps,
})

export const PersonalContactsTable = sqliteTable("zero_personal_contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  metadata: text("metadata"),
  ...Timestamps,
})

export const PersonalApiConnectionsTable = sqliteTable("zero_personal_api_connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  base_url: text("base_url").notNull(),
  auth_type: text("auth_type"),
  auth_value: text("auth_value"),
  headers: text("headers"),
  ...Timestamps,
})

export const PersonalKnowledgeTable = sqliteTable("zero_personal_knowledge", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  source: text("source"),
  tags: text("tags"),
  embedding: text("embedding"),
  ...Timestamps,
})

export const PersonalWorkflowsTable = sqliteTable("zero_personal_workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  steps: text("steps"),
  trigger: text("trigger"),
  active: integer("active"),
  ...Timestamps,
})

export const PersonalWatchersTable = sqliteTable("zero_personal_watchers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  target: text("target").notNull(),
  condition: text("condition"),
  action: text("action"),
  active: integer("active"),
  last_triggered: integer("last_triggered"),
  ...Timestamps,
})
