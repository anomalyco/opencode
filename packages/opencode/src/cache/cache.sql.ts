import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core"

export const ToolCacheTable = sqliteTable("tool_cache", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  schema_json: text().notNull(),
  embedding: blob({ mode: "buffer" }),
  embed_model: text(),
  content_hash: text(),
  is_l1: integer().notNull().default(0),
  use_count: integer().notNull().default(0),
  last_used: integer(),
  registered: integer().notNull(),
})

export const SkillCacheTable = sqliteTable("skill_cache", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  location: text().notNull(),
  embedding: blob({ mode: "buffer" }),
  embed_model: text(),
  content_hash: text(),
  is_l1: integer().notNull().default(0),
  use_count: integer().notNull().default(0),
  last_used: integer(),
  registered: integer().notNull(),
})
