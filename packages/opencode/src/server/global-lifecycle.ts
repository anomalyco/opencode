import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { SessionStatus } from "@/session/status"
import { Effect } from "effect"
import { Event } from "./event"

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean }) {
    const store = yield* InstanceStore.Service
    yield* Effect.gen(function* () {
      yield* options?.swallowErrors
        ? store.disposeAll().pipe(Effect.catchCause((cause) => Effect.logWarning("global disposal failed", { cause })))
        : store.disposeAll()
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
)

// Disposing an instance cancels every session runner it owns, so a config
// reload that lands while the model is streaming aborts the run. External
// reload triggers (SIGUSR2 from desktop theme hooks) wait here until every
// session is idle, so the reload is deferred rather than dropped. Background
// jobs are not part of the wait.
export const reloadWhenSessionsIdle = Effect.fn("Server.reloadWhenSessionsIdle")(function* () {
  const store = yield* InstanceStore.Service
  const status = yield* SessionStatus.Service
  const config = yield* Config.Service
  let deferred = false
  while (true) {
    const instances = yield* store.list()
    const active = yield* Effect.forEach(instances, (ctx) =>
      status.list().pipe(Effect.provideService(InstanceRef, ctx)),
    )
    const sessions = active.reduce((count, item) => count + item.size, 0)
    if (sessions === 0) break
    if (!deferred) yield* Effect.logInfo("deferring reload until sessions are idle", { sessions })
    deferred = true
    yield* Effect.sleep(IDLE_POLL_INTERVAL)
  }
  if (deferred) yield* Effect.logInfo("sessions idle, reloading")
  yield* config.invalidate()
  yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
})

const IDLE_POLL_INTERVAL = "250 millis"

export * as GlobalLifecycle from "./global-lifecycle"
