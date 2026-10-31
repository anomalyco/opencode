import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Marketplace } from "@opencode/schema/marketplace"

export const MarketplaceTable = sqliteTable("marketplace_registry", {
  id: integer().primaryKey(),
  revision: integer().notNull(),
  installed: text({ mode: "json" }).$type<(typeof Marketplace.State.Encoded)["installed"]>().notNull(),
})
