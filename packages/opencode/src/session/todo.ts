import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { Database, eq, asc } from "../storage"
import { TodoTable } from "./session.sql"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
})
  .annotate({ identifier: "Todo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: BusEvent.define(
    "todo.updated",
    Schema.Struct({
      sessionID: SessionID,
      todos: Schema.Array(Info),
    }),
  ),
}

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
          if (input.todos.length === 0) return
          db.insert(TodoTable)
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
        }),
      )
      yield* bus.publish(Event.Updated, input)
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
        ),
      )
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Todo from "./todo"
