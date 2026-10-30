import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer } from "../../src/database/sqlite.bun"
import { fileLogger } from "../../src/observability/logging"

const [filename, log, mode, milliseconds] = process.argv.slice(2)

const program = Effect.gen(function* () {
  const sql = yield* Client.SqlClient
  if (mode === "blocked") {
    yield* sql.unsafe(`PRAGMA busy_timeout = ${Number(milliseconds)}`)
    yield* sql.unsafe("BEGIN IMMEDIATE").pipe(Effect.ignore)
    return
  }
  yield* sql.unsafe("CREATE TABLE IF NOT EXISTS item(value INTEGER)")
  const ready = Effect.sync(() => process.stdout.write("locked\n"))
  if (mode === "immediate" || mode === "deferred" || mode === "short") {
    yield* sql.unsafe(mode === "deferred" ? "BEGIN" : "BEGIN IMMEDIATE")
    yield* sql.unsafe("INSERT INTO item(value) VALUES (1)")
    yield* ready
    yield* Effect.sleep(Number(milliseconds))
    yield* sql.unsafe("COMMIT")
    return
  }
  if (mode === "statement") {
    yield* ready
    yield* sql.unsafe(
      `INSERT INTO item(value) WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${Number(milliseconds)}) SELECT x FROM n`,
    )
    return
  }
  throw new Error(`unknown mode ${mode}`)
}).pipe(Effect.withSpan("WriteHoldChild.hold", { attributes: { "session.id": "ses_write_hold_child" } }))

await program.pipe(
  Effect.provide(layer({ filename })),
  Effect.provide(Logger.layer([fileLogger(log, "child")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie)),
  Effect.runPromise,
)
