import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Prompt drafts and history. `key` is `${storage}:${key}` as the renderer draft store writes it.
export const document = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})

// Images referenced from documents by content hash.
export const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
})

// Everything the renderer persists through `platform.storage(name)`. `name` is the storage
// namespace the app chooses (still spelled like the `.dat` file it used to be) and `key` the
// entry within it, so the app's relocation and alias logic keeps working unchanged.
export const state = sqliteTable(
  "state",
  {
    name: text().notNull(),
    key: text().notNull(),
    value: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.key] })],
)
