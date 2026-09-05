import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

// Semantic recall index over session transcript parts. Rows are keyed by
// `${part_id}:${chunk_index}` so re-indexing a part is an idempotent upsert.
// No foreign keys: deletions are mirrored from durable session events by the
// recall indexer (sessions may be removed while indexing is in flight).
export const RecallChunkTable = sqliteTable(
  "recall_chunk",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    message_id: text().notNull(),
    part_id: text().notNull(),
    chunk_index: integer().notNull(),
    provider: text().notNull(),
    dim: integer().notNull(),
    model_id: text().notNull(),
    text_hash: text().notNull(),
    text: text().notNull(),
    vec: blob({ mode: "buffer" }).notNull(),
    ...Timestamps,
  },
  (table) => [
    index("recall_chunk_session_idx").on(table.session_id),
    index("recall_chunk_part_idx").on(table.part_id),
    index("recall_chunk_message_idx").on(table.message_id),
  ],
)
