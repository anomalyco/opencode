import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { makeRuntime } from "@/effect/run-service"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
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
        yield* Effect.sync(() => {
          const db = Database.resolveSession(input.sessionID)
          db.transaction((tx) => {
            tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
            tx.insert(TodoTable)
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
          })
        })
        yield* bus.publish(Event.Updated, input)
      })

      const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
        const rows = yield* Effect.sync(() => {
          const db = Database.resolveSession(sessionID)
          return db
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, sessionID))
            .orderBy(asc(TodoTable.position))
            .all()
        })
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

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(sessionID: SessionID) {
    return runPromise((svc) => svc.get(sessionID))
  }

  export async function update(input: { sessionID: SessionID; todos: Info[] }) {
    return runPromise((svc) => svc.update(input))
  }
}
