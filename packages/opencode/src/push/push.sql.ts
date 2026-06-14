import { integer, text, sqliteTable } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@opencode-ai/core/database/schema.sql"

export const PushSubscriptionTable = sqliteTable("push_subscription", {
  id: text().primaryKey(),
  endpoint: text().notNull(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  server_origin: text().notNull(),
  device_label: text(),
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
  failure_count: integer().notNull().$default(() => 0),
  last_error: text(),
  last_success_at: integer(),
  last_failure_at: integer(),
  ...Timestamps,
})

export const PushDeliveryTable = sqliteTable("push_delivery", {
  id: text().primaryKey(),
  subscription_id: text().notNull(),
  payload: text().notNull(),
  kind: text().notNull(),
  tag: text().notNull(),
  ttl_seconds: integer().notNull(),
  urgency: text().notNull(),
  attempt_count: integer().notNull().$default(() => 0),
  next_attempt_at: integer().notNull(),
  last_error: text(),
  last_status: integer(),
  ...Timestamps,
})
