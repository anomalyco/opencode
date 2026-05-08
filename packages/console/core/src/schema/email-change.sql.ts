import { index, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { id, timestamps, ulid, utc } from "../drizzle/types"

export const EmailChangeTable = mysqlTable(
  "email_change",
  {
    id: id(),
    ...timestamps,
    accountID: ulid("account_id").notNull(),
    oldEmail: varchar("old_email", { length: 255 }).notNull(),
    newEmail: varchar("new_email", { length: 255 }).notNull(),
    oldTokenHash: varchar("old_token_hash", { length: 64 }).notNull(),
    newTokenHash: varchar("new_token_hash", { length: 64 }).notNull(),
    oldConfirmedAt: utc("old_confirmed_at"),
    newConfirmedAt: utc("new_confirmed_at"),
    completedAt: utc("completed_at"),
    cancelledAt: utc("cancelled_at"),
    expiresAt: utc("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("old_token_hash").on(table.oldTokenHash),
    uniqueIndex("new_token_hash").on(table.newTokenHash),
    index("account_id").on(table.accountID),
    index("new_email").on(table.newEmail),
  ],
)
