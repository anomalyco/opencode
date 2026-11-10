import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { Timestamps } from "../database/schema.sql.js"
import type { ServerIdentity } from "../server-identity.js"

export const ServerUserTable = sqliteTable(
  "server_user",
  {
    id: text().$type<ServerIdentity.UserID>().primaryKey(),
    method: text({ mode: "text" }).$type<ServerIdentity.Method>().notNull(),
    username: text().notNull(),
    display_name: text(),
    email: text(),
    // Argon2id hash, verified with Bun.password. Null for identities that authenticate outside this server, like LDAP.
    password_hash: text(),
    status: text().$type<ServerIdentity.UserStatus>().notNull().$default(() => "active"),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("server_user_method_username_idx").on(table.method, table.username),
    index("server_user_method_idx").on(table.method),
  ],
)

export const ServerSessionTable = sqliteTable(
  "server_session",
  {
    id: text().$type<ServerIdentity.SessionID>().primaryKey(),
    // Pairing sessions have no identity: a pairing code proves access to the machine, not who is behind it.
    user_id: text().$type<ServerIdentity.UserID>().references(() => ServerUserTable.id, { onDelete: "cascade" }),
    method: text({ mode: "text" }).$type<ServerIdentity.SessionMethod>().notNull(),
    // Unix seconds; an expired session is invalid on first sight, and a background sweep may delete it.
    expires_at: integer().notNull(),
    revoked_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("server_session_user_id_idx").on(table.user_id),
    index("server_session_expires_at_idx").on(table.expires_at),
  ],
)
