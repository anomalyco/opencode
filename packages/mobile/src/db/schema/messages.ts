import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { sessions } from "./sessions"

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), // message ID from server
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),

  // Timestamps with millisecond precision using SQLite's subsec modifier
  timeCreated: integer("time_created")
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`), // Milliseconds timestamp with SQLite subsec
  timeCompleted: integer("time_completed"), // Milliseconds timestamp

  // Assistant-specific fields
  providerId: text("provider_id"),
  modelId: text("model_id"),
  mode: text("mode"),
  pathCwd: text("path_cwd"),
  pathRoot: text("path_root"),
  isSummary: integer("is_summary", { mode: "boolean" }).default(false),

  // Cost and token usage
  cost: real("cost").default(0),
  tokensInput: integer("tokens_input").default(0),
  tokensOutput: integer("tokens_output").default(0),
  tokensReasoning: integer("tokens_reasoning").default(0),
  tokensCacheRead: integer("tokens_cache_read").default(0),
  tokensCacheWrite: integer("tokens_cache_write").default(0),

  // Error information
  errorName: text("error_name"),
  errorMessage: text("error_message"),
  errorData: text("error_data"), // JSON string

  // System prompts
  systemPrompts: text("system_prompts"), // JSON array of strings

  // Local metadata
  isSynced: integer("is_synced", { mode: "boolean" }).default(false),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})
