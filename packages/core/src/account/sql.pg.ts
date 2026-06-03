import { pgTable, text, integer, primaryKey, boolean, bigint } from "drizzle-orm/pg-core"

import { AccountV2 } from "../account"
import { PgTimestamps } from "../database/schema.pg"

export const PgAccountTable = pgTable("account", {
  id: text().$type<AccountV2.ID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccountV2.AccessToken>().notNull(),
  refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
  token_expiry: bigint({ mode: "number" }),
  ...PgTimestamps,
})

export const PgAccountStateTable = pgTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountV2.ID>()
    .references(() => PgAccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<AccountV2.OrgID>(),
})

export const PgControlAccountTable = pgTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().$type<AccountV2.AccessToken>().notNull(),
    refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
  token_expiry: bigint({ mode: "number" }),
  active: boolean()
      .notNull()
      .$default(() => false),
    ...PgTimestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)
