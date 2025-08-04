import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // session ID from server
  parentId: text("parent_id"), // for session forking
  title: text("title").notNull(),
  version: text("version").notNull(),
  shareUrl: text("share_url"), // if session is shared
  timeCreated: integer("time_created", { mode: "timestamp" }).notNull(),
  timeUpdated: integer("time_updated", { mode: "timestamp" }).notNull(),

  // Revert state
  revertMessageId: text("revert_message_id"),
  revertPartId: text("revert_part_id"),
  revertSnapshot: text("revert_snapshot"),
  revertDiff: text("revert_diff"),

  // Aggregated cost and token usage
  totalCost: real("total_cost").default(0),
  totalTokensInput: integer("total_tokens_input").default(0),
  totalTokensOutput: integer("total_tokens_output").default(0),
  totalTokensReasoning: integer("total_tokens_reasoning").default(0),
  totalTokensCacheRead: integer("total_tokens_cache_read").default(0),
  totalTokensCacheWrite: integer("total_tokens_cache_write").default(0),
  messageCount: integer("message_count").default(0),

  // Local metadata
  isSynced: integer("is_synced", { mode: "boolean" }).default(false),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),
  isFavorite: integer("is_favorite", { mode: "boolean" }).default(false),
  localNotes: text("local_notes"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
})
