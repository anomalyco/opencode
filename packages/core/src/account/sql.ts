import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"

import { AccountV2 } from "../account"
import { Timestamps } from "../database/schema.sql"

export const AccountTable = sqliteTable("account", {
  id: text().$type<AccountV2.ID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccountV2.AccessToken>().notNull(),
  refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
  token_expiry: integer(),
  ...Timestamps,
})

export const AccountStateTable = sqliteTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountV2.ID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<AccountV2.OrgID>(),
})

// LEGACY
export const ControlAccountTable = sqliteTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().$type<AccountV2.AccessToken>().notNull(),
    refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
    token_expiry: integer(),
    active: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)
