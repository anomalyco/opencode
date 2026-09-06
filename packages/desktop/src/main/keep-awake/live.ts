import { app, powerSaveBlocker } from "electron"
import { Effect, Layer } from "effect"
import { KEEP_AWAKE_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { KeepAwake } from "./index"

export const KeepAwakeLive = Layer.effect(
  KeepAwake.Service,
  Effect.gen(function* () {
    const store = getStore()
    const awake = yield* KeepAwake.make({
      power: powerSaveBlocker,
      persistence: {
        read: () => store.get(KEEP_AWAKE_ENABLED_KEY),
        write: (enabled) => store.set(KEEP_AWAKE_ENABLED_KEY, enabled),
      },
    })
    app.on("will-quit", awake.dispose)
    yield* Effect.addFinalizer(() => Effect.sync(() => app.off("will-quit", awake.dispose)))
    return awake
  }),
)
