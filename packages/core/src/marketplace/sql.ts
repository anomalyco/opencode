import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { MarketplaceInstalled, MarketplaceSource } from "../marketplace"

export const MarketplaceRegistryTable = sqliteTable("marketplace_registry", {
  id: integer().primaryKey(),
  revision: integer().notNull(),
  time_updated: integer().notNull(),
})

export const MarketplaceAuditTable = sqliteTable(
  "marketplace_audit",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    revision: integer().notNull(),
    action: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("marketplace_audit_revision_idx").on(table.revision)],
)

export const MarketplaceSourceTable = sqliteTable(
  "marketplace_source",
  {
    id: text().primaryKey(),
    data: text({ mode: "json" }).$type<MarketplaceSource>().notNull(),
    position: integer().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("marketplace_source_position_idx").on(table.position)],
)

export const MarketplaceInstallTable = sqliteTable(
  "marketplace_install",
  {
    key: text().primaryKey(),
    data: text({ mode: "json" }).$type<MarketplaceInstalled>().notNull(),
    position: integer().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("marketplace_install_position_idx").on(table.position)],
)

export const MarketplaceArtifactTable = sqliteTable(
  "marketplace_artifact",
  {
    digest: text().primaryKey(),
    size: integer().notNull(),
    media_type: text(),
    kind: text().notNull(),
    source_url: text(),
    time_created: integer().notNull(),
    time_accessed: integer().notNull(),
  },
  (table) => [index("marketplace_artifact_accessed_idx").on(table.time_accessed)],
)

export const MarketplaceFetchTable = sqliteTable(
  "marketplace_fetch",
  {
    key: text().primaryKey(),
    url: text().notNull(),
    digest: text()
      .notNull()
      .references(() => MarketplaceArtifactTable.digest, { onDelete: "cascade" }),
    etag: text(),
    last_modified: text(),
    status: integer().notNull(),
    time_fetched: integer().notNull(),
  },
  (table) => [
    index("marketplace_fetch_digest_idx").on(table.digest),
    index("marketplace_fetch_time_idx").on(table.time_fetched),
  ],
)

export const MarketplaceMaterializationTable = sqliteTable(
  "marketplace_materialization",
  {
    digest: text().primaryKey(),
    path: text().notNull(),
    artifacts: text({ mode: "json" }).$type<string[]>().notNull(),
    time_created: integer().notNull(),
    time_accessed: integer().notNull(),
  },
  (table) => [index("marketplace_materialization_accessed_idx").on(table.time_accessed)],
)
