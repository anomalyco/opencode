import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"

/** An in-memory SQLite client that records every statement it runs, so a test can count them or ask SQLite how it plans them. */
export const recordedSql = () => {
  const statements: Array<{ readonly query: string; readonly params: ReadonlyArray<unknown> }> = []
  const layer = Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient
      const connection = yield* client.reserve
      const record = (query: string, params: ReadonlyArray<unknown>) => statements.push({ query, params })
      return yield* SqlClient.make({
        acquirer: Effect.succeed({
          ...connection,
          execute: (query, params, transform) => {
            record(query, params)
            return connection.execute(query, params, transform)
          },
          executeValues: (query, params) => {
            record(query, params)
            return connection.executeValues(query, params)
          },
        }),
        compiler: Statement.makeCompilerSqlite(),
        driver: client.driver,
        spanAttributes: [],
      })
    }),
  ).pipe(
    Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
    Layer.provide(Reactivity.layer),
    Layer.orDie,
  )
  return { statements, layer }
}
