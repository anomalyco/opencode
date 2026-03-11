import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"

import { type AccountID, type OrgID } from "./schema"
import { Timestamps } from "../storage/schema.sql"

export const AccountTable = sqliteTable("account", {
  id: text().$type<AccountID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().notNull(),
  refresh_token: text().notNull(),
  token_expiry: integer(),
  ...Timestamps,
})

export const AccountStateTable = sqliteTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<OrgID>(),
})

// LEGACY
export const ControlAccountTable = sqliteTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().notNull(),
    refresh_token: text().notNull(),
    token_expiry: integer(),
    active: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)
