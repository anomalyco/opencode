import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const AccountTable = sqliteTable("account", {
  id: text().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().notNull(),
  refresh_token: text().notNull(),
  token_expiry: integer(),
  org_id: text(),
  ...Timestamps,
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
  (table) => [
    primaryKey({ columns: [table.email, table.url] }),
    // uniqueIndex("control_account_active_idx").on(table.email).where(eq(table.active, true)),
  ],
)
