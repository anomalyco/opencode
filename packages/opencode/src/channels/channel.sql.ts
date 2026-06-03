import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const channelTable = sqliteTable("channel_config", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  webhook_url: text("webhook_url").default(""),
  config: text("config"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
})

export * as ChannelSQL from "./channel.sql"
