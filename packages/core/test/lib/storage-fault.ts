import { Database as Native, type SQLQueryBindings } from "bun:sqlite"
import { Context, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient } from "effect/unstable/sql"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { Database } from "@opencode/core/database/database"
import { Sqlite } from "@opencode/core/database/sqlite"

const fullError = new SqlError({
  reason: classifySqliteError(genuineFullError(), { message: "Failed to execute statement", operation: "execute" }),
})

/**
 * An in-memory SQLite database whose writes can be made to fail like a full disk.
 *
 * With a full disk and WAL, SQLite buffers a transaction's pages and fails at COMMIT with
 * SQLITE_FULL, rolling the transaction back on its own; autocommit writes fail outright.
 * Reads keep working. The fault reproduces exactly that, using a genuine SQLITE_FULL error.
 */
export function make() {
  const state = { full: false, failures: 0 }
  const fail = () => {
    state.failures++
    return Effect.fail(fullError)
  }

  const client = Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      const native = new Native(":memory:")
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      state.full = false
      state.failures = 0
      const rejects = (query: string) => {
        if (!state.full) return false
        if (/^\s*commit\b/i.test(query)) {
          native.run("ROLLBACK")
          return true
        }
        return !native.inTransaction && /^\s*(insert|update|delete|replace)\b/i.test(query)
      }
      const execute =
        <A>(read: (statement: ReturnType<Native["query"]>, params: SQLQueryBindings[]) => A) =>
        (query: string, params: ReadonlyArray<unknown> = []) =>
          Effect.withFiber<A, SqlError>((fiber) => {
            if (rejects(query)) return fail()
            const statement = native.query(query)
            // @ts-ignore bun-types missing safeIntegers method
            statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
            try {
              return Effect.succeed(read(statement, params as SQLQueryBindings[]))
            } catch (cause) {
              return Effect.fail(
                new SqlError({
                  reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
                }),
              )
            }
          })
      const connection = Sqlite.makeConnection(
        execute((statement, params) => (statement.all(...params) ?? []) as Array<Record<string, unknown>>),
        execute((statement, params) => (statement.values(...params) ?? []) as Array<unknown[]>),
        {},
      )
      return yield* Sqlite.makeClient({}, connection, "~test/StorageFault", () => ({}))
    }),
  ).pipe(Layer.provide(Reactivity.layer))

  return {
    node: Database.configuredClient(client),
    /** Writes fail with SQLITE_FULL until `free`. */
    fill: Effect.sync(() => {
      state.full = true
    }),
    free: Effect.sync(() => {
      state.full = false
    }),
    failures: Effect.sync(() => state.failures),
  }
}

/** Lets TestClock time pass in half-second steps, settling fibers between them so retries can reschedule. */
export const elapse = Effect.fnUntraced(function* (millis: number) {
  for (let elapsed = 0; elapsed < millis; elapsed += 500) {
    yield* Effect.yieldNow
    yield* TestClock.adjust("500 millis")
  }
  yield* Effect.yieldNow
})

function genuineFullError() {
  const scratch = new Native(":memory:")
  try {
    scratch.run("PRAGMA max_page_count = 1")
    scratch.run("CREATE TABLE filler (value TEXT)")
  } catch (cause) {
    return cause
  } finally {
    scratch.close()
  }
  throw new Error("Expected SQLITE_FULL")
}

export * as StorageFault from "./storage-fault"
