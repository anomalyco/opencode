export * as SessionSearchBuild from "./search-build.js"

import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { SessionSearchIndex } from "./search-index.js"

export interface Progress {
  readonly label: string
  readonly numerator: number
  readonly denominator: number
}

export type Status =
  | { readonly status: "disabled" }
  | { readonly status: "running" | "paused"; readonly progress: Progress }
  | { readonly status: "completed"; readonly skipped: number }
  | { readonly status: "unsupported" | "error"; readonly error: string }

export interface Interface {
  /**
   * Keeps `experimental.sqlite_fts` on for the scope it runs in, as a location with the flag on does for as long as it
   * is loaded. The one-time build of existing history runs while any location holds it, from a persisted cursor, and
   * pauses when none does; triggers keep the index current once it is done.
   */
  readonly hold: Effect.Effect<void, never, Scope.Scope>
  readonly status: Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSearchBuild") {}

/** Pause between transactions so requests waiting on the JS thread or the write lock get a turn. */
const PAUSE = "5 millis"
const BUSY = "1 second"
/** Rows in a row that fail on their own before the failure is taken to be the database's, not the rows'. */
const MAX_FAILURES = 3

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const scope = yield* Scope.Scope
    const runtime = {
      holds: 0,
      // A failed build waits for the flag to be turned off and on again, or for a version that rebuilds it.
      retry: false,
      fiber: undefined as Fiber.Fiber<void> | undefined,
      building: false,
      unsupported: undefined as string | undefined,
    }

    const build = Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis
      const stats = { chunks: 0, slowest: 0, single: 0, failures: 0 }
      yield* Effect.logInfo("session search build started")
      while (true) {
        const now = yield* Clock.currentTimeMillis
        // A row that fails on its own is retried alone, so one bad row only skips itself.
        const exit = yield* SessionSearchIndex.buildChunk(db, { limit: stats.single > 0 ? 1 : undefined }).pipe(
          Effect.exit,
        )
        if (Exit.isSuccess(exit)) {
          stats.chunks++
          stats.slowest = Math.max(stats.slowest, (yield* Clock.currentTimeMillis) - now)
          stats.single = Math.max(0, stats.single - 1)
          stats.failures = 0
          if (exit.value.done) {
            const state = yield* SessionSearchIndex.state(db)
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
        if (SessionSearchIndex.isBusy(exit.cause)) {
          yield* Effect.sleep(BUSY)
          continue
        }
        if (stats.single === 0) {
          stats.single = SessionSearchIndex.ChunkLimit
          continue
        }
        stats.failures++
        if (stats.failures >= MAX_FAILURES) {
          yield* SessionSearchIndex.fail(db, Cause.pretty(exit.cause))
          yield* Effect.logError("session search build failed", { cause: exit.cause })
          return "failed" as const
        }
        yield* Effect.logWarning("session search skipped a row it could not index", { cause: exit.cause })
        yield* SessionSearchIndex.buildChunk(db, { limit: 1, skip: true })
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          runtime.building = false
        }),
      ),
    )

    const run = Effect.gen(function* () {
      const state = yield* SessionSearchIndex.state(db)
      if (state && state.version > SessionSearchIndex.Version) return
      const built = SessionSearchIndex.current(state) ? state : undefined
      if (built?.status === "done") return
      if (built?.status === "failed") {
        if (!runtime.retry) return
        yield* SessionSearchIndex.retry(db)
      }
      runtime.retry = false
      const ensured = yield* SessionSearchIndex.ensure(db)
      if (ensured.status === "unsupported") {
        runtime.unsupported = ensured.reason
        yield* Effect.logWarning("session search is not supported by this SQLite", { reason: ensured.reason })
        return
      }
      if (ensured.status !== "ready") return
      runtime.building = true
      yield* build
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) => Effect.logError("session search build stopped", { cause }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          runtime.fiber = undefined
        }),
      ),
    )

    // The first hold starts the build, if it isn't done; releasing the last one interrupts it between transactions.
    const hold = Effect.acquireRelease(
      Effect.gen(function* () {
        runtime.holds++
        if (runtime.holds === 1 && !runtime.fiber) runtime.fiber = yield* Effect.forkIn(run, scope)
      }),
      () =>
        Effect.gen(function* () {
          runtime.holds--
          if (runtime.holds > 0) return
          runtime.retry = true
          if (runtime.fiber) yield* Fiber.interrupt(runtime.fiber)
        }),
    )

    const status = Effect.gen(function* () {
      if (runtime.unsupported) return { status: "unsupported", error: runtime.unsupported } satisfies Status
      const state = yield* SessionSearchIndex.state(db)
      if (!SessionSearchIndex.current(state)) return { status: "disabled" } satisfies Status
      if (state.status === "done") return { status: "completed", skipped: state.skipped } satisfies Status
      if (state.status === "failed")
        return { status: "error", error: state.error ?? "The session search build failed" } satisfies Status
      return {
        status: runtime.building ? "running" : "paused",
        progress: {
          label: "Indexing session history",
          numerator: state.processed,
          denominator: Math.max(state.total, state.processed),
        },
      } satisfies Status
    })

    return Service.of({ hold, status })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})
