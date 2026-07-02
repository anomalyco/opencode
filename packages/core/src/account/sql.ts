import { sqliteTable, text, integer, primaryKey, real, index } from "drizzle-orm/sqlite-core"

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

// --- token-management: per-user identity, balance, append-only transactions ---

// Microsoft identity persisted from the ID token JWT during login. `id` is the
// stable `oid` (object id) issued by Entra ID. First row inserted after a clean
// deploy receives `isAdmin = 1`; every subsequent user gets `isAdmin = 0`.
export const UserIdentityTable = sqliteTable("user_identity", {
  id: text().primaryKey(),
  email: text().notNull(),
  displayName: text(),
  tenantId: text(),
  createdAt: integer().notNull().$default(() => Date.now()),
  lastLoginAt: integer().notNull().$default(() => Date.now()),
  isAdmin: integer().notNull().default(0),
})

// 1:1 with `user_identity`. Cascade on delete keeps balance rows from outliving
// the identity they belong to.
export const TokenBalanceTable = sqliteTable("token_balance", {
  userId: text()
    .primaryKey()
    .references(() => UserIdentityTable.id, { onDelete: "cascade" }),
  balance: integer().notNull().default(0),
  lifetimeUsed: integer().notNull().default(0),
  updatedAt: integer().notNull().$default(() => Date.now()),
})

// Append-only ledger. Positive `amount` = credit, negative = consumption.
// Indexed by (user_id, created_at) so per-user history scans are cheap.
export const TokenTransactionTable = sqliteTable(
  "token_transaction",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: text()
      .notNull()
      .references(() => UserIdentityTable.id, { onDelete: "cascade" }),
    amount: integer().notNull(),
    description: text(),
    sessionId: text(),
    model: text(),
    tokensUsed: integer(),
    costUsd: real(),
    createdAt: integer().notNull().$default(() => Date.now()),
  },
  (table) => [index("idx_tx_user").on(table.userId, table.createdAt)],
)
