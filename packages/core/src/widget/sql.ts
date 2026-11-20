import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Widget } from "@opencode/schema/widget"
import { Timestamps } from "../database/schema.sql.js"

/**
 * Every template version ever saved or shown, immutable by `(name, version)`. The latest version of a name is the row
 * updated last: saving content that already exists promotes that version again.
 */
export const WidgetTemplateTable = sqliteTable(
  "widget_template",
  {
    name: text().notNull(),
    version: text().notNull(),
    description: text().notNull(),
    data: text({ mode: "json" }).$type<Widget.DataSchema>().notNull(),
    source: text().notNull(),
    builtin: integer({ mode: "boolean" }).notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.name, table.version] }),
    index("widget_template_latest_idx").on(table.name, table.time_updated),
  ],
)
