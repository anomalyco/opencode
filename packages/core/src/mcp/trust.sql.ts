import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Project } from "@opencode/schema/project"
import { ProjectTable } from "../project/sql.js"
import { Timestamps } from "../database/schema.sql.js"

export const TrustedHostTable = sqliteTable(
  "mcp_trusted_host",
  {
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    host: text().notNull(),
    port: integer().notNull(),
    fingerprint: text().notNull(),
    subject: text().notNull(),
    valid_to: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.project_id, table.host, table.port] })],
)
