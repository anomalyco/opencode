import { sqliteTable, text, integer, index, primaryKey, blob } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import type { DocID, ActorID, AssetID } from "./schema"
import { Timestamps } from "../storage/schema.sql"

export const DocTable = sqliteTable("doc", {
  id: text().$type<DocID>().primaryKey(),
  kind: text().notNull(),
  ...Timestamps,
})

export const DocUpdateTable = sqliteTable(
  "doc_update",
  {
    id: text().primaryKey(),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    data: blob().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("doc_update_doc_idx").on(table.doc_id)],
)

export const SessionPromptDocTable = sqliteTable("session_prompt_doc", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  doc_id: text()
    .$type<DocID>()
    .notNull()
    .references(() => DocTable.id, { onDelete: "cascade" }),
})

export const SessionActorTable = sqliteTable(
  "session_actor",
  {
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    user_id: text(),
    name: text().notNull(),
    color: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_seen: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.actor_id] }),
    index("session_actor_session_idx").on(table.session_id),
  ],
)

export const DocAssetTable = sqliteTable(
  "doc_asset",
  {
    id: text().$type<AssetID>().notNull(),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    mime: text().notNull(),
    data: blob().notNull(),
    size: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.doc_id, table.id] }), index("doc_asset_doc_idx").on(table.doc_id)],
)
