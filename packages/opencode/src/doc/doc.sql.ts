import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, blob } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import type { DocID, ActorID, AssetID, SubmitID } from "./schema"
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

export const DocSubmitTable = sqliteTable(
  "doc_submit",
  {
    id: text().$type<SubmitID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    status: text().notNull(),
    prompt: text().notNull(),
    timeout_ms: integer().notNull(),
    expires_at: integer().notNull(),
    cancelled_by: text().$type<ActorID>(),
    ...Timestamps,
  },
  (table) => [
    index("doc_submit_session_doc_status_idx").on(table.session_id, table.doc_id, table.status),
    index("doc_submit_expires_idx").on(table.expires_at),
    // At most one pending submit per (session, doc) — closes the concurrent-create race.
    uniqueIndex("doc_submit_pending_unique")
      .on(table.session_id, table.doc_id)
      .where(sql`${table.status} = 'pending'`),
  ],
)

export const DocSubmitActorTable = sqliteTable(
  "doc_submit_actor",
  {
    submit_id: text()
      .$type<SubmitID>()
      .notNull()
      .references(() => DocSubmitTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    name: text().notNull(),
    status: text().notNull(),
    time_responded: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.submit_id, table.actor_id] }),
    index("doc_submit_actor_actor_idx").on(table.actor_id),
  ],
)
