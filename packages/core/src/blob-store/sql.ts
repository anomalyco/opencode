import { sql } from "drizzle-orm"
import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { BlobStore } from "@opencode/schema/blob-store"
import type { SessionSchema } from "../session/schema.js"
import { Timestamps } from "../database/schema.sql.js"

/**
 * One row per stored blob. Width, height and duration are read from the bytes once, when the blob is written; name and
 * metadata are the client's. `session_id` is only a label, so it has no foreign key.
 */
export const BlobV2Table = sqliteTable(
  "blob_v2",
  {
    id: text().$type<BlobStore.ID>().primaryKey(),
    session_id: text().$type<SessionSchema.ID>(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    name: text(),
    width: integer(),
    height: integer(),
    duration_ms: integer(),
    metadata: text({ mode: "json" }).$type<BlobStore.Metadata>(),
    ...Timestamps,
  },
  (table) => [
    index("blob_v2_session_idx")
      .on(table.session_id, table.time_created)
      .where(sql`${table.session_id} is not null`),
  ],
)

/** The bytes of blobs of at most 1 MB; larger ones are files under `<data>/blobs/`. */
export const BlobDataTable = sqliteTable(
  "blob_data",
  {
    blob_id: text()
      .$type<BlobStore.ID>()
      .notNull()
      .references(() => BlobV2Table.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    data: blob({ mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.blob_id, table.seq] })],
)
