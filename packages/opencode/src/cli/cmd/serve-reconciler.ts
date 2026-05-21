import { Cause, Duration, Effect, Schedule } from "effect"
import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { SessionRunState } from "@/session/run-state"
import * as Session from "@/session/session"

function num(key: string, fallback: number) {
  const raw = Number(process.env[key])
  if (!Number.isFinite(raw)) return fallback
  return Math.max(0, Math.floor(raw))
}

const reconcileOnce = Effect.fn("Cli.serve.reconcileOnce")(function* () {
  const scan = num("OPENCODE_SERVE_RECONCILE_SCAN_LIMIT", 100)
  if (scan <= 0) return

  const rows = yield* Effect.sync(() => [...Session.listGlobal({ limit: scan })])
  const store = yield* InstanceStore.Service
  const seen = new Set<string>()

  for (const item of rows) {
    if (seen.has(item.directory)) continue
    seen.add(item.directory)

    yield* store
      .provide(
        { directory: item.directory },
        Effect.gen(function* () {
          const runState = yield* SessionRunState.Service
          yield* runState.reconcile()
        }),
      )
      .pipe(
        Effect.provideService(WorkspaceRef, item.workspaceID),
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause)
          return Effect.logWarning("status reconcile failed", { directory: item.directory, error })
        }),
      )
  }
})

export const reconciler = Effect.fn("Cli.serve.reconciler")(function* () {
  const intervalSeconds = num("OPENCODE_SERVE_RECONCILE_INTERVAL_S", 30)
  if (intervalSeconds <= 0) return
  yield* reconcileOnce().pipe(Effect.repeat(Schedule.spaced(Duration.seconds(intervalSeconds))), Effect.ignore)
})
