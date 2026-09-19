import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Question } from "@opencode-ai/schema/question"
import { SessionTable } from "./session/sql"
import type { SessionSchema } from "./session/schema"

export const QuestionPendingTable = sqliteTable(
  "question_pending",
  {
    id: text().$type<Question.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    request: text({ mode: "json" }).$type<Question.Request>().notNull(),
    asked_seq: integer().notNull(),
  },
  (table) => [index("question_pending_session_seq_idx").on(table.session_id, table.asked_seq)],
)
