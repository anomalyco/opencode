import { deepStrictEqual, strictEqual, ok } from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { layer } from "../../src/database/sqlite.node"

const filename = process.argv[1]
const blocker = new DatabaseSync(filename)
blocker.exec("PRAGMA journal_mode = WAL; CREATE TABLE t(id INTEGER PRIMARY KEY)")

try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* SqlClient
      for (const values of [false, true]) {
        blocker.exec("BEGIN IMMEDIATE")
        const release = setTimeout(() => blocker.exec("COMMIT"), 150)
        try {
          const query = client.unsafe<{ id: number }>("INSERT INTO t VALUES(?) RETURNING id", [values ? 2 : 1])
          const rows = yield* values ? query.values : Effect.map(query, (rows) => rows.map((row) => row.id))
          deepStrictEqual(rows, values ? [[2]] : [1])
        } finally {
          clearTimeout(release)
          if (blocker.isTransaction) blocker.exec("ROLLBACK")
        }
      }
      deepStrictEqual(yield* client.unsafe("SELECT COUNT(*) FROM t").values, [[2]])
      const preparation = yield* Effect.result(client.unsafe("SELECT * FROM missing_table"))
      strictEqual(preparation._tag, "Failure")
      if (preparation._tag === "Failure") strictEqual(preparation.failure.reason.operation, "execute")

      // A competing commit makes this read transaction's WAL snapshot stale.
      const snapshot = yield* Effect.result(
        client.withTransaction(
          Effect.gen(function* () {
            yield* client.unsafe("SELECT * FROM t")
            blocker.exec("INSERT INTO t VALUES(3)")
            yield* client.unsafe("INSERT INTO t VALUES(4)")
          }),
        ),
      )
      strictEqual(snapshot._tag, "Failure")
      if (snapshot._tag === "Failure") {
        strictEqual(snapshot.failure.reason._tag, "LockTimeoutError")
        ok(snapshot.failure.message.includes("SQLite 517"))
      }
      deepStrictEqual(yield* client.unsafe("SELECT COUNT(*) FROM t").values, [[3]])
    }).pipe(Effect.provide(layer({ filename, timeout: 0 })), Effect.scoped),
  )
  console.log("Node SQLite checks passed")
} finally {
  blocker.close()
}
