import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const PatentWorkflowTable = sqliteTable("patent_workflow", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  workflow_type: text().notNull(),
  current_step: integer().notNull(),
  total_steps: integer().notNull(),
  status: text().notNull(),
  step_outputs: text().notNull(),
  case_id: text(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})