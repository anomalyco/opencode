import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import { ConfigFingerprint } from "@/config/fingerprint"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Option } from "effect"
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
// themes/*.json and never touch the config. Disposing instances aborts their
// in-flight sessions, so only pay that cost when config inputs actually
// changed. Covers the global config and every loaded instance's on-disk
// inputs (project config, agent/command/mode/plugin files, OPENCODE_CONFIG).
// A read failure or a missing fingerprint baseline counts as changed, keeping
// the historical unconditional-dispose behavior for any case the gate cannot
// prove is clean. Returns whether instances were disposed.
export const reloadIfConfigChanged = Effect.fn("Server.reloadIfConfigChanged")(function* () {
  const config = yield* Config.Service
  const store = yield* InstanceStore.Service
  // ConfigParse throws on malformed files, surfacing here as a defect rather
  // than a typed error, so read via catchAllCause: a failed read must never
  // block invalidation, and unprovable means changed.
  const read = config.getGlobal().pipe(
    Effect.map(Option.some),
    Effect.catchCause((cause) =>
      Effect.logWarning("global config read failed during reload check", { cause: String(cause) }).pipe(
        Effect.as(Option.none()),
      ),
    ),
  )
  const before = yield* read
  yield* config.invalidate()
  const next = yield* read
  const globalChanged =
    Option.isNone(before) || Option.isNone(next) || !ConfigFingerprint.canonicalEquals(before.value, next.value)
  if (globalChanged || (yield* store.configChanged())) {
    yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
    return true
  }
  return false
})

export * as GlobalLifecycle from "./global-lifecycle"
