import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { SessionID } from "../session/schema"

export const KnowledgeEntryTable = sqliteTable(
  "knowledge_entry",
  {
    id: text().primaryKey(),
    type: text().notNull(), // "pattern" | "knowledge" | "log"
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent: text().notNull(), // "implementer", "shade", "oracle", etc.
    title: text().notNull(),
    description: text().notNull(),
    content: text({ mode: "json" }).notNull(), // Full structured data as JSON
    tags: text({ mode: "json" }).notNull().$type<string[]>(), // ["recovery", "network"]
    tag_weights: text({ mode: "json" }).$type<Record<string, number>>(), // { "critical": 2.0 }
    category: text(), // "architecture", "performance", etc.
    confidence: integer(), // 0-100 (stored as integer)
    first_attempt_failed: integer(), // 0 or 1 (boolean as int)
    impact: text(), // "high" | "medium" | "low"
    related_files: text({ mode: "json" }).$type<string[]>(),
    ...Timestamps,
  },
  (table) => [
    index("knowledge_type_idx").on(table.type),
    index("knowledge_session_idx").on(table.session_id),
    index("knowledge_agent_idx").on(table.agent),
    index("knowledge_created_idx").on(table.time_created),
  ],
)

export const KnowledgeSearchIndexTable = sqliteTable(
  "knowledge_search_index",
  {
    entry_id: text()
      .primaryKey()
      .references(() => KnowledgeEntryTable.id, { onDelete: "cascade" }),
    tag_vector: text().notNull(), // Space-separated tags for FTS
    title_text: text().notNull(), // Lowercased for search
    description_text: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("knowledge_fts_idx").on(table.tag_vector, table.title_text)],
)
