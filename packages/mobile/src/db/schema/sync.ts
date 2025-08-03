import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const syncQueue = sqliteTable("sync_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationType: text("operation_type", { enum: ["create", "update", "delete"] }).notNull(),
  resourceType: text("resource_type", { enum: ["session", "message", "message_part"] }).notNull(),
  resourceId: text("resource_id").notNull(),
  payload: text("payload"), // JSON payload for the operation

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  lastError: text("last_error"),

  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).default("pending"),
})

export const eventLog = sqliteTable("event_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  data: text("data"), // JSON data

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
})
