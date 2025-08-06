import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  website: text("website"),
  isAvailable: integer("is_available", { mode: "boolean" }).default(true),

  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})
