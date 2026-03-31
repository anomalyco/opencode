import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import { ProjectTable } from "../project/project.sql"

export const MemoryPreferenceTable = sqliteTable(
  "memory_preference",
  {
    id: text().primaryKey(),
    key: text().notNull(),
    value: text({ mode: "json" }).notNull(),
    type: text().notNull(),
    description: text(),
    ...Timestamps,
  },
  (table) => [index("memory_preference_key_idx").on(table.key)],
)

export const MemoryRuleTable = sqliteTable(
  "memory_rule",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pattern: text().notNull(),
    rule: text().notNull(),
    priority: integer().notNull().default(0),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    ...Timestamps,
  },
  (table) => [
    index("memory_rule_project_idx").on(table.project_id),
    index("memory_rule_pattern_idx").on(table.pattern),
  ],
)

export const MemoryAPIKeyTable = sqliteTable(
  "memory_api_key",
  {
    id: text().primaryKey(),
    provider: text().notNull(),
    key_name: text().notNull(),
    encrypted_value: text().notNull(),
    description: text(),
    ...Timestamps,
  },
  (table) => [
    index("memory_api_key_provider_idx").on(table.provider),
    index("memory_api_key_name_idx").on(table.key_name),
  ],
)
