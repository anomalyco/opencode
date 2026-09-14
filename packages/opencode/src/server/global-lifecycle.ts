import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import { InstanceStore } from "@/project/instance-store"
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

// External reload signals (SIGUSR2 from theme switchers such as Omarchy or
// Noctalia hooks) usually mean "repaint": themes are discovered from
// themes/*.json and never touch the global config. Disposing instances
// aborts their in-flight sessions, so only pay that cost when the global
// config itself actually changed. Returns whether instances were disposed.
export const reloadIfGlobalConfigChanged = Effect.fn("Server.reloadIfGlobalConfigChanged")(function* () {
  const config = yield* Config.Service
  const before = yield* config.getGlobal()
  yield* config.invalidate()
  const next = yield* config.getGlobal()
  if (JSON.stringify(before) === JSON.stringify(next)) return false
  yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
  return true
})

export * as GlobalLifecycle from "./global-lifecycle"
