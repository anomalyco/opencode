import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const models = sqliteTable("models", {
  id: text("id").primaryKey(), // model ID from server (providerId:modelId)
  name: text("name").notNull(),
  providerId: text("provider_id").notNull(),
  providerName: text("provider_name").notNull(),
  contextLength: integer("context_length"),
  outputLength: integer("output_length"),
  inputPrice: real("input_price"),
  outputPrice: real("output_price"),
  cacheReadPrice: real("cache_read_price"),
  cacheWritePrice: real("cache_write_price"),
  attachment: integer("attachment", { mode: "boolean" }).default(false),
  reasoning: integer("reasoning", { mode: "boolean" }).default(false),
  temperature: integer("temperature", { mode: "boolean" }).default(true),
  toolCall: integer("tool_call", { mode: "boolean" }).default(false),
  knowledge: text("knowledge"), // knowledge cutoff date
  releaseDate: text("release_date"),
  lastUpdated: text("last_updated"),
  openWeights: integer("open_weights", { mode: "boolean" }).default(false),

  // Local metadata
  isCached: integer("is_cached", { mode: "boolean" }).default(true),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date()),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
})
