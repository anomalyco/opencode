import { primaryKey, sqliteTable, text, unique, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"

export const UiProjectViewTable = sqliteTable("ui_project_view", {
  id: text().primaryKey(),
  name: text().notNull(),
  ...Timestamps,
})

export const UiOpenProjectTable = sqliteTable(
  "ui_open_project",
  {
    view_id: text()
      .notNull()
      .references(() => UiProjectViewTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    position: integer().notNull(),
    expanded: integer({ mode: "boolean" }).notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.view_id, table.project_id] }), unique().on(table.view_id, table.position)],
)

export const UiProjectViewLastProjectTable = sqliteTable("ui_project_view_last_project", {
  view_id: text()
    .primaryKey()
    .references(() => UiProjectViewTable.id, { onDelete: "cascade" }),
  project_id: text()
    .$type<ProjectV2.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  directory: text().notNull(),
  time_updated: integer().notNull(),
})
