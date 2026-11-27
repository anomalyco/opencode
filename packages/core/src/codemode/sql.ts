import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { JsonSchema } from "effect"
import { Timestamps } from "../database/schema.sql.js"

export const SavedToolTable = sqliteTable(
  "codemode_tool",
  {
    /** The project ID it belongs to, or `*` for one every project sees. */
    scope: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    input: text({ mode: "json" }).$type<JsonSchema.JsonSchema>().notNull(),
    output: text({ mode: "json" }).$type<JsonSchema.JsonSchema>(),
    /** The source of the script's `run` function. */
    code: text().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.scope, table.name] })],
)
