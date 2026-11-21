export * as SessionStats from "./stats.js"

import { DateTime, Effect, Schema } from "effect"
import type { Worker } from "node:worker_threads"
import { Database } from "../database/database.js"
import { compute, type Input, type RawResult, type ResolvedInput } from "./stats-query.js"
import type { Reply, Request } from "./stats-worker.js"

export class InvalidRangeError extends Schema.TaggedError<InvalidRangeError>()("SessionStats.InvalidRangeError", {
  from: Schema.Finite,
  to: Schema.Finite,
}) {}

export class WorkerUnavailableError extends Schema.TaggedError<WorkerUnavailableError>()(
  "SessionStats.WorkerUnavailableError",
  {
    permanent: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {}

export type WorkerRunner = (filename: string, query: ResolvedInput) => Effect.Effect<RawResult, WorkerUnavailableError>

// Runs read-only stats queries in a dedicated worker thread so heavy scans over
// large SQLite databases never block the server's main event loop. Terminates
// the worker immediately when the caller fiber is interrupted (e.g. client abort).
export const runInWorker =
  (url?: URL, onSpawn?: (worker: Worker) => void): WorkerRunner =>
  (filename, query) =>
    Effect.callback<RawResult, WorkerUnavailableError>((resume) => {
      let settled = false
      let worker: Worker | undefined
      let detach: (() => void) | undefined
      const cleanup = () => {
        detach?.()
        detach = undefined
        if (!worker) return
        const current = worker
        worker = undefined
        current.unref()
        void current.terminate()
      }
      const settle = (effect: Effect.Effect<RawResult, WorkerUnavailableError>) => {
        if (settled) return
        settled = true
        cleanup()
        resume(effect)
      }

      void import("node:worker_threads").then(
        ({ Worker }) => {
          if (settled) return
          const target = url ?? new URL("./stats-worker.js", import.meta.url)
          try {
            const created = new Worker(target, {
              workerData: { filename, query } satisfies Request,
            })
            const onMessage = (reply: Reply) => {
              if (reply._tag === "Ok") return settle(Effect.succeed(reply.result))
              if (reply._tag === "Unavailable") {
                return settle(
                  Effect.fail(new WorkerUnavailableError({ permanent: false, cause: new Error(reply.message) })),
                )
              }
              settle(Effect.die(new Error(reply.message)))
            }
            const onMessageError = (cause: Error) => settle(Effect.die(cause))
            const onError = (cause: Error) =>
              settle(Effect.fail(new WorkerUnavailableError({ permanent: true, cause })))
            const onExit = (code: number) => {
              if (settled) return
              settle(
                Effect.fail(
                  new WorkerUnavailableError({
                    permanent: true,
                    cause: new Error(`session stats worker exited with code ${code}`),
                  }),
                ),
              )
            }
            worker = created
            detach = () => {
              created
                .off("message", onMessage)
                .off("messageerror", onMessageError)
                .off("error", onError)
                .off("exit", onExit)
            }
            created
              .once("message", onMessage)
              .once("messageerror", onMessageError)
              .once("error", onError)
              .once("exit", onExit)
            onSpawn?.(created)
          } catch (cause) {
            settle(Effect.fail(new WorkerUnavailableError({ permanent: true, cause })))
          }
        },
        (cause) => settle(Effect.fail(new WorkerUnavailableError({ permanent: true, cause }))),
      )

      return Effect.sync(() => {
        settled = true
        cleanup()
      })
    })

export function makeGet(runner: WorkerRunner = runInWorker()) {
  let useWorker = true

  return Effect.fn("SessionStats.get")(function* (input: Input = {}) {
    const database = yield* Database.Service
    const to = input.to ?? Date.now()
    if (input.from !== undefined && input.from >= to) return yield* new InvalidRangeError({ from: input.from, to })
    const query: ResolvedInput = { ...input, to }
    const raw =
      useWorker && database.path !== undefined
        ? yield* runner(database.path, query).pipe(
            Effect.catchTag("SessionStats.WorkerUnavailableError", (error) => {
              if (!error.permanent) {
                return Effect.logWarning(
                  "session stats worker could not open database, computing stats on the main thread",
                  { cause: error.cause },
                ).pipe(Effect.andThen(compute(database.db, query)))
              }
              if (!useWorker) return compute(database.db, query)
              useWorker = false
              return Effect.logWarning("session stats worker unavailable, computing stats on the main thread", {
                cause: error.cause,
              }).pipe(Effect.andThen(compute(database.db, query)))
            }),
          )
        : yield* compute(database.db, query)
    return {
      ...raw,
      range: { from: DateTime.makeUnsafe(raw.range.from), to: DateTime.makeUnsafe(raw.range.to) },
    }
  })
}

export const get = makeGet()
