import { GlobalBus } from "@/bus/global"
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
// reload that lands while the model is streaming aborts the run. Callers that
// reload on an external trigger (SIGUSR2, config writes) wait here first so the
// reload is deferred rather than dropped.
export const awaitSessionsIdle = Effect.fn("Server.awaitSessionsIdle")(function* () {
  while (yield* sessionsBusy) {
    yield* Effect.sleep(IDLE_POLL_INTERVAL)
  }
})

const IDLE_POLL_INTERVAL = "250 millis"

const sessionsBusy = Effect.gen(function* () {
  const store = yield* InstanceStore.Service
  const status = yield* SessionStatus.Service
  const instances = yield* store.list()
  const active = yield* Effect.forEach(instances, (ctx) => status.list().pipe(Effect.provideService(InstanceRef, ctx)))
  return active.some((sessions) => sessions.size > 0)
})

export * as GlobalLifecycle from "./global-lifecycle"
