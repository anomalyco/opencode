import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"

export const memoryTable = sqliteTable("self_improvement_memory", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  workspace_id: text("workspace_id"),
  type: text("type").notNull().$type<"episodic" | "semantic" | "procedural" | "pattern">(),
  layer: text("layer").notNull().$type<"short_term" | "long_term" | "semantic" | "procedural">(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),
  importance: real("importance").notNull().default(0.5),
  confidence: real("confidence").notNull().default(0.8),
  access_count: integer("access_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  time_created: integer("time_created").notNull(),
  time_last_accessed: integer("time_last_accessed").notNull(),
  time_last_evolved: integer("time_last_evolved"),
  heartbeat_at: integer("heartbeat_at"),
})

export * as SelfImprovementMemory from "./memory.sql"
