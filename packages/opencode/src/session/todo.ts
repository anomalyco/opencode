import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "./schema"
import { Cause, Duration, Effect, Layer, Context } from "effect"
import { isSqlError } from "effect/unstable/sql/SqlError"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { TodoTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionTodo } from "@opencode-ai/schema/session-todo"

/**
 * True when the failure is a transient SQLite write-lock conflict (SQLITE_BUSY).
 * Drizzle wraps the underlying SqlError in an EffectDrizzleQueryError whose
 * `cause` is a `Cause<SqlError>`, so walk the error/cause chain until we find
 * a SqlError.
 */
export function isRetryableSqlError(cause: Cause.Cause<unknown>): boolean {
  let current: unknown = Cause.squash(cause)
  for (let i = 0; i < 5 && current !== undefined; i++) {
    if (isSqlError(current)) return current.isRetryable
    if (Cause.isCause(current)) {
      current = Cause.squash(current)
      continue
    }
    if (current instanceof Error) {
      const nested = (current as { cause?: unknown }).cause
      if (nested === undefined || nested === current) break
      current = nested
    } else {
      break
    }
  }
  return false
}

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info

export const Event = SessionTodo.Event

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) {
      // Retry transient write-lock conflicts (SQLITE_BUSY) instead of crashing:
      // parallel subagents can call todowrite concurrently, and a busy error is
      // retryable — orDie turned it into a fatal defect (issue #40020).
      const writeTransaction = () =>
        db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
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
          }),
        )
      const runWrite = (attempt: number): Effect.Effect<void, never, never> =>
        writeTransaction().pipe(
          Effect.catchCause((cause) => {
            if (!isRetryableSqlError(cause) || attempt >= 4) return Effect.failCause(cause).pipe(Effect.orDie)
            return Effect.sleep(Duration.millis(10 * 2 ** attempt)).pipe(
              Effect.andThen(runWrite(attempt + 1)),
            )
          }),
        )
      yield* runWrite(0)
      yield* events.publish(Event.Updated, input)
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
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

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })

export * as Todo from "./todo"
