import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Athena } from "@opencode-ai/stats-core/athena"
import { layer as statsLayer } from "@opencode-ai/stats-core/runtime"
import { syncStats } from "@opencode-ai/stats-core/stat-sync"
import { Cause, Effect, Layer, Schedule } from "effect"

const SYNC_INTERVAL = "1 hour"

const runtimeLayer = Layer.mergeAll(statsLayer, Athena.layer)
const syncPass = syncStats().pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning(`stats sync failed ${JSON.stringify({ cause: Cause.pretty(cause) })}`),
  ),
)
const daemon = Effect.logInfo("stats sync daemon started").pipe(
  Effect.andThen(syncPass.pipe(Effect.repeat(Schedule.fixed(SYNC_INTERVAL)))),
  Effect.forkScoped,
)

NodeRuntime.runMain(Layer.launch(Layer.effectDiscard(daemon).pipe(Layer.provide(runtimeLayer))), {
  disableErrorReporting: true,
})
