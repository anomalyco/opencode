import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Prompt drafts and history. `key` is `${storage}:${key}` as the renderer draft store writes it.
export const document = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})

// Images and text chunks referenced from documents by content hash. `touched_at` is the last time
// a blob was uploaded or a written document referenced it; collection leaves recent blobs alone.
export const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
  touched_at: integer().notNull().default(0),
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

// GUI plugin enable state, for built-in and plugin GUIs alike. A plugin gets a row only once its
// enable state changes. `manifest` and `revision` are unused; they stay because releases from 2.0.24
// until the rename still read them, through the read-only `extension` view the rename migration leaves, so a
// downgraded app can open this database.
export const plugin = sqliteTable("plugin", {
  id: text().primaryKey(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  manifest: text(),
  revision: text(),
})
