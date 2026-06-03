import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import { AccountV2 } from "../account"
import { Timestamps } from "../database/schema.sql"
import { DatabaseDialect } from "../database/dialect"
import { PgAccountTable, PgAccountStateTable, PgControlAccountTable } from "./sql.pg"

const _SqliteAccountTable = sqliteTable("account", {
  id: text().$type<AccountV2.ID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccountV2.AccessToken>().notNull(),
  refresh_token: text().$type<AccountV2.RefreshToken>().notNull(),
  token_expiry: integer(),
  ...Timestamps,
})

const _SqliteAccountStateTable = sqliteTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountV2.ID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<AccountV2.OrgID>(),
})

const _SqliteControlAccountTable = sqliteTable(
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

type SqliteAccountTable = typeof _SqliteAccountTable
type SqliteAccountStateTable = typeof _SqliteAccountStateTable
type SqliteControlAccountTable = typeof _SqliteControlAccountTable

export const AccountTable: SqliteAccountTable = DatabaseDialect.isPostgres() ? PgAccountTable as any : _SqliteAccountTable
export const AccountStateTable: SqliteAccountStateTable = DatabaseDialect.isPostgres() ? PgAccountStateTable as any : _SqliteAccountStateTable
export const ControlAccountTable: SqliteControlAccountTable = DatabaseDialect.isPostgres() ? PgControlAccountTable as any : _SqliteControlAccountTable
