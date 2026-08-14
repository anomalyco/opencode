import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { ModelStatRepo } from "@opencode-ai/stats-core/domain/model"
import { R2Sql } from "@opencode-ai/stats-core/r2-sql"
import { layer as statsLayer } from "@opencode-ai/stats-core/runtime"
import { syncStats } from "@opencode-ai/stats-core/stat-sync"
import { Cause, Duration, Effect, Layer, Schedule } from "effect"

const SYNC_INTERVAL = "1 hour"
const SYNC_INTERVAL_MS = 3_600_000

const runtimeLayer = Layer.mergeAll(statsLayer, R2Sql.layer)

const daemon = Effect.gen(function* () {
  yield* Effect.logInfo("stats sync daemon started")
  yield* initialDelay()

  // One full pass per UTC day (including the first pass after boot) refreshes the
  // whole display window; every other pass only recomputes the current ISO week.
  let lastFullDay = ""
  const pass = Effect.gen(function* () {
    const today = new Date().toISOString().slice(0, 10)
    if (lastFullDay !== today) {
      const completed = yield* syncStats({ full: true }).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning(`full stats sync failed; falling back to incremental sync ${Cause.pretty(cause)}`).pipe(
            Effect.as(false),
          ),
        ),
      )
      lastFullDay = today
      if (completed) return
    }
    yield* syncStats({ full: false })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`stats sync failed ${JSON.stringify({ cause: Cause.pretty(cause) })}`),
    ),
  )
  yield* pass.pipe(Effect.repeat(Schedule.fixed(SYNC_INTERVAL)))
}).pipe(Effect.forkScoped)

// A restarted daemon must not immediately re-run the R2 SQL pass; resume the
// hourly cadence from the last completed sync instead. This caps the query spend
// of a crash loop at one pass per interval.
const initialDelay = Effect.fnUntraced(function* () {
  const modelStats = yield* ModelStatRepo
  const lastSynced = yield* modelStats.lastSyncedAt().pipe(Effect.catchCause(() => Effect.succeed(null)))
  if (!lastSynced) return
  const delayMs = Math.min(SYNC_INTERVAL_MS - (Date.now() - lastSynced.getTime()), SYNC_INTERVAL_MS)
  if (delayMs <= 0) return
  yield* Effect.logInfo(
    `stats sync delaying first pass ${JSON.stringify({ lastSyncedAt: lastSynced.toISOString(), delayMs })}`,
  )
  yield* Effect.sleep(Duration.millis(delayMs))
})

NodeRuntime.runMain(Layer.launch(Layer.effectDiscard(daemon).pipe(Layer.provide(runtimeLayer))), {
  disableErrorReporting: true,
})
