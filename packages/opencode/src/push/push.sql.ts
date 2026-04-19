import { integer, text, sqliteTable } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const PushSubscriptionTable = sqliteTable("push_subscription", {
  id: text().primaryKey(),
  endpoint: text().notNull(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  expiration_time: integer(),
  enabled: integer({ mode: "boolean" })
    .notNull()
    .$default(() => true),
  notify_on_completion: integer({ mode: "boolean" })
    .notNull()
    .$default(() => true),
  notify_on_error: integer({ mode: "boolean" })
    .notNull()
    .$default(() => false),
  user_agent: text(),
  last_error: text(),
  ...Timestamps,
})
