export * as SessionTodo from "./todo"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { SessionTable, TodoTable } from "./sql"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
}).annotate({ identifier: "SessionTodo.Info" })
export type Info = typeof Info.Type

export const Event = {
  Updated: EventV2.define({
    type: "todo.updated",
    schema: {
      sessionID: SessionSchema.ID,
      todos: Schema.Array(Info),
    },
  }),
}

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Info>
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionTodo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const update = Effect.fn("SessionTodo.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly todos: ReadonlyArray<Info>
    }) {
      const wrote = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // todo.session_id is a cascade FK to session.id. If the session was
            // removed concurrently, the INSERT below would fail the FK at COMMIT
            // and crash via orDie. Skip when the parent session is gone.
            const session = yield* tx
              .select({ id: SessionTable.id })
              .from(SessionTable)
              .where(eq(SessionTable.id, input.sessionID))
              .get()
            if (!session) {
              yield* Effect.logWarning("skipping todo update; parent session absent", { sessionID: input.sessionID })
              return false
            }
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return true
            yield* tx
              .insert(TodoTable)
              .values(
                input.todos.map((todo, position) => ({
                  session_id: input.sessionID,
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  position,
                })),
              )
              .run()
            return true
          }),
        )
        .pipe(Effect.orDie)
      if (!wrote) return
      yield* events.publish(Event.Updated, input)
    })

    const get = Effect.fn("SessionTodo.get")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
