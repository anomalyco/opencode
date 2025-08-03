import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { sessions } from "./sessions"
import { messages } from "./messages"

export const messageParts = sqliteTable("message_parts", {
  id: text("id").primaryKey(), // part ID from server
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["text", "file", "tool", "step-start", "step-finish", "snapshot", "patch"],
  }).notNull(),

  // Text parts
  textContent: text("text_content"),
  isSynthetic: integer("is_synthetic", { mode: "boolean" }).default(false),
  timeStart: integer("time_start", { mode: "timestamp" }),
  timeEnd: integer("time_end", { mode: "timestamp" }),

  // File parts
  fileMime: text("file_mime"),
  fileFilename: text("file_filename"),
  fileUrl: text("file_url"),
  fileSourceType: text("file_source_type", { enum: ["file", "symbol"] }),
  fileSourcePath: text("file_source_path"),
  fileSourceTextValue: text("file_source_text_value"),
  fileSourceTextStart: integer("file_source_text_start"),
  fileSourceTextEnd: integer("file_source_text_end"),
  fileSourceName: text("file_source_name"), // for symbol sources
  fileSourceKind: integer("file_source_kind"), // for symbol sources
  fileSourceRange: text("file_source_range"), // JSON string for LSP.Range

  // Tool parts
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  toolStatus: text("tool_status", { enum: ["pending", "running", "completed", "error"] }),
  toolInput: text("tool_input"), // JSON string
  toolOutput: text("tool_output"),
  toolTitle: text("tool_title"),
  toolMetadata: text("tool_metadata"), // JSON string
  toolError: text("tool_error"),
  toolTimeStart: integer("tool_time_start", { mode: "timestamp" }),
  toolTimeEnd: integer("tool_time_end", { mode: "timestamp" }),

  // Step parts (step-finish)
  stepCost: real("step_cost"),
  stepTokensInput: integer("step_tokens_input"),
  stepTokensOutput: integer("step_tokens_output"),
  stepTokensReasoning: integer("step_tokens_reasoning"),
  stepTokensCacheRead: integer("step_tokens_cache_read"),
  stepTokensCacheWrite: integer("step_tokens_cache_write"),

  // Snapshot parts
  snapshotId: text("snapshot_id"),

  // Patch parts
  patchHash: text("patch_hash"),
  patchFiles: text("patch_files"), // JSON array of file paths

  // Local metadata
  isSynced: integer("is_synced", { mode: "boolean" }).default(false),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})
