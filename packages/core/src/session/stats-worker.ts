import { parentPort, workerData } from "node:worker_threads"
import { Effect } from "effect"
import { sqliteLayer, supportsTuningPragmas } from "#sqlite"
import { EffectDrizzleSqlite } from "../database/drizzle.js"
import { compute, type RawResult, type ResolvedInput } from "./stats-query.js"

export type Request = {
  readonly filename: string
  readonly query: ResolvedInput
}

export type Reply =
  | { readonly _tag: "Ok"; readonly result: RawResult }
  | { readonly _tag: "Unavailable"; readonly message: string }
  | { readonly _tag: "Error"; readonly message: string }

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()

const port = parentPort
if (port) {
  const request = workerData as Request
  let opened = false
  // Run inside Effect.scoped so SQLite closes its file handles before posting the reply.
  void Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* makeDatabase
        if (supportsTuningPragmas) {
          yield* db.run("PRAGMA query_only = ON").pipe(Effect.orDie)
          yield* db.run("PRAGMA busy_timeout = 5000").pipe(Effect.orDie)
          yield* db.run("PRAGMA cache_size = -16000").pipe(Effect.orDie)
        }
        opened = true
        return yield* compute(db, request.query)
      }).pipe(Effect.provide(sqliteLayer({ filename: request.filename, readonly: true }))),
    ),
  ).then(
    (result) => {
      port.postMessage({ _tag: "Ok", result } satisfies Reply)
    },
    (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      port.postMessage({ _tag: opened ? "Error" : "Unavailable", message } satisfies Reply)
    },
  )
}
