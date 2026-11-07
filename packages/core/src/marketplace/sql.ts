import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { MarketplaceLocal } from "../marketplace.js"

export const MarketplaceTable = sqliteTable("marketplace_registry", {
  id: integer().primaryKey(),
  revision: integer().notNull(),
  installed: text({ mode: "json" }).$type<(typeof MarketplaceLocal.State.Encoded)["installed"]>().notNull(),
})
