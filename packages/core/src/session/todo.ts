export * as SessionTodo from "./todo.js"

import { asc, eq } from "drizzle-orm"
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { SessionSchema } from "./schema.js"

type DatabaseService = Database.Interface["db"]

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text().$type<SessionSchema.ID>().notNull(),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.position] })],
)

export type Todo = {
  readonly content: string
  readonly status: string
  readonly priority: string
  readonly position: number
}

export const get = Effect.fn("SessionTodo.get")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select({
      content: TodoTable.content,
      status: TodoTable.status,
      priority: TodoTable.priority,
      position: TodoTable.position,
    })
    .from(TodoTable)
    .where(eq(TodoTable.session_id, sessionID))
    .orderBy(asc(TodoTable.position))
    .all()
    .pipe(Effect.orDie)
  return rows
})
