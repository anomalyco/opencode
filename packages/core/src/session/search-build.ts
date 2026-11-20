export * as SessionSearchBuild from "./search-build.js"

import { Cause, Clock, Context, Effect, Exit, Latch, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { SessionSearchIndex } from "./search-index.js"

export interface Interface {
  /**
   * Waits for {@link start}, then runs the one-time build of existing history until it is done, from its persisted
   * cursor; triggers keep the index current after that. The server forks it, like `Automation.Service.run`, so it runs
   * once per server process and never in a Durable Object. A build that failed before is retried once.
   */
  readonly run: Effect.Effect<void>
  /** Lets {@link run} go, once a location has the `sqlite_fts` flag on. Later calls do nothing. */
  readonly start: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSearchBuild") {}

/** Pause between transactions so requests waiting on the JS thread or the write lock get a turn. */
const PAUSE = "5 millis"
const BUSY = "1 second"
/** Rows in a row that fail on their own before the failure is taken to be the database's, not the rows'. */
const MAX_FAILURES = 3

const retryOnBusy = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      SessionSearchIndex.isBusy(cause)
        ? Effect.sleep(BUSY).pipe(Effect.andThen(() => retryOnBusy(effect)))
        : Effect.failCause(cause),
    ),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const started = yield* Latch.make()
    const chunk = (options?: { readonly limit?: number; readonly skip?: boolean }) =>
      retryOnBusy(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const result = yield* SessionSearchIndex.buildChunk(db, options)
          return { ...result, ms: (yield* Clock.currentTimeMillis) - now }
        }),
      )

    const build = Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis
      const stats = { chunks: 0, slowest: 0, single: 0, failures: 0 }
      yield* Effect.logInfo("session search build started")
      while (true) {
        // A row that fails on its own is retried alone, so one bad row only skips itself.
        const exit = yield* chunk({ limit: stats.single > 0 ? 1 : undefined }).pipe(Effect.exit)
        if (Exit.isSuccess(exit)) {
          stats.chunks++
          stats.slowest = Math.max(stats.slowest, exit.value.ms)
          stats.single = Math.max(0, stats.single - 1)
          stats.failures = 0
          if (exit.value.done) {
            const state = yield* retryOnBusy(SessionSearchIndex.state(db))
            yield* Effect.logInfo("session search build finished", {
              ms: (yield* Clock.currentTimeMillis) - started,
              chunks: stats.chunks,
              slowestChunkMs: stats.slowest,
              skipped: state && "skipped" in state ? state.skipped : 0,
            })
            return "done" as const
          }
          yield* Effect.sleep(PAUSE)
          continue
        }
        if (Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
        if (stats.single === 0) {
          stats.single = SessionSearchIndex.ChunkLimit
          continue
        }
        stats.failures++
        if (stats.failures >= MAX_FAILURES) {
          yield* retryOnBusy(SessionSearchIndex.fail(db, Cause.pretty(exit.cause)))
          yield* Effect.logError("session search build failed", { cause: exit.cause })
          return "failed" as const
        }
        yield* Effect.logWarning("session search skipped a row it could not index", { cause: exit.cause })
        yield* chunk({ limit: 1, skip: true })
      }
    })

    const run = Effect.gen(function* () {
      yield* started.await
      const ensured = yield* retryOnBusy(SessionSearchIndex.ensure(db))
      if (ensured.status === "unsupported") {
        yield* Effect.logWarning("session search is not supported by this SQLite", { reason: ensured.reason })
        return
      }
      if (ensured.status !== "ready" || ensured.state.status === "done") return
      if (ensured.state.status === "failed") yield* retryOnBusy(SessionSearchIndex.retry(db))
      yield* build
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) => Effect.logError("session search build stopped", { cause }),
      ),
    )

    return Service.of({ run, start: started.open })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})
