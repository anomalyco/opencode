import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ClientKVTable = sqliteTable("kv", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).notNull().$type<unknown>(),
  time_updated: integer().notNull(),
})

export const ClientPromptHistoryTable = sqliteTable("prompt_history", {
  id: integer().primaryKey({ autoIncrement: true }),
  data: text({ mode: "json" }).notNull().$type<unknown>(),
  time_created: integer().notNull(),
})
