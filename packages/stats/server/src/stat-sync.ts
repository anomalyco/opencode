import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { ModelStatRepo } from "@bolt-ai/stats-core/domain/model"
import { R2Sql } from "@bolt-ai/stats-core/r2-sql"
import { layer as statsLayer } from "@bolt-ai/stats-core/runtime"
import { syncStats } from "@bolt-ai/stats-core/stat-sync"
import { Cause, Duration, Effect, Layer, Schedule } from "effect"

const SYNC_INTERVAL = "1 hour"
const SYNC_INTERVAL_MS = 3_600_000

const runtimeLayer = Layer.mergeAll(statsLayer, R2Sql.layer)

const daemon = Effect.gen(function* () {
  yield* Effect.logInfo("stats sync daemon started")
  yield* initialDelay()

  // Every pass recomputes the current ISO week. Once per UTC day, including after
  // boot, it also starts a history pass for the rest of the display window. That
  // pass takes over an hour, so it runs in the background instead of holding back
  // the next hourly pass.
  let lastHistoryDay = ""
  let historyRunning = false
  const history = syncStats({ history: true }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`stats history sync failed ${JSON.stringify({ cause: Cause.pretty(cause) })}`),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        historyRunning = false
      }),
    ),
  )
  const pass = Effect.gen(function* () {
    yield* syncStats()
    const today = new Date().toISOString().slice(0, 10)
    // A history pass still running past midnight defers the next day's until it ends.
    if (lastHistoryDay === today || historyRunning) return
    lastHistoryDay = today
    historyRunning = true
    yield* Effect.forkChild(history)
  }).pipe(
    Effect.tapCause((cause) =>
      Effect.logWarning(`stats sync failed ${JSON.stringify({ cause: Cause.pretty(cause) })}`),
    ),
    // Without a retry, one transient R2 SQL failure leaves the site stale until the
    // next hourly pass. Two retries cap the extra query spend per interval.
    Effect.retry({ times: 2, schedule: Schedule.spaced("10 minutes") }),
    Effect.ignoreCause,
  )
  yield* pass.pipe(Effect.repeat(Schedule.fixed(SYNC_INTERVAL)))
}).pipe(Effect.forkScoped)

// A restarted daemon must not immediately re-run the R2 SQL pass; resume the
// hourly cadence from the last completed sync instead. This caps the query spend
// of a crash loop at one pass per interval. Only hourly passes write the current
// week, so a history pass that rewrote older periods cannot push this back.
const initialDelay = Effect.fnUntraced(function* () {
  const modelStats = yield* ModelStatRepo
  const lastSynced = yield* modelStats
    .lastSyncedAt(syncRange(new Date()).periodStart)
    .pipe(Effect.catchCause(() => Effect.succeed(null)))
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
