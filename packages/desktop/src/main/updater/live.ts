export * as UpdaterLive from "./live"

import { dialog } from "electron"
import { Effect, Layer } from "effect"
import type { UpdaterState } from "@opencode-ai/app/updater"
import { UPDATER_ENABLED } from "../constants"
import { DesktopInitialization } from "../lifecycle/desktop-initialization"
import { ApplicationLifecycle } from "../lifecycle"
import { nativeT } from "../native/translations"
import { make, Service } from "./index"

const key = "ready"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* ApplicationLifecycle.Service
    const desktop = yield* DesktopInitialization.Service
    const platform = UPDATER_ENABLED
      ? yield* Effect.gen(function* () {
          const { make } = yield* Effect.promise(() => import("./platform"))
          return yield* make
        })
      : undefined
    return yield* make({
      currentVersion: desktop.version,
      platform,
      prepareToRestart: lifecycle.prepareToRestart,
      persistence: {
        get: Effect.sync(() => {
          const value = desktop.updaterStore.get(key)
          if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
          return { version: value.version }
        }),
        set: (value) => Effect.sync(() => desktop.updaterStore.set(key, value)),
        clear: Effect.sync(() => desktop.updaterStore.delete(key)),
      },
      show,
    })
  }),
)

const show = Effect.fn("Updater.show")(function* (
  check: Effect.Effect<UpdaterState>,
  install: Effect.Effect<void, unknown>,
) {
  const state = yield* check
  if (state.status === "error") {
    yield* promise(() =>
      dialog.showMessageBox({
        type: "error",
        message: nativeT("desktop.updater.dialog.checkFailed.message"),
        title: nativeT("desktop.updater.dialog.checkFailed.title"),
      }),
    )
    return
  }
  if (state.status === "up-to-date") {
    yield* promise(() =>
      dialog.showMessageBox({
        type: "info",
        message: nativeT("desktop.updater.dialog.upToDate.message"),
        title: nativeT("desktop.updater.dialog.upToDate.title"),
      }),
    )
    return
  }
  if (state.status !== "ready") return

  const response = yield* promise(() =>
    dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
      title: nativeT("desktop.updater.dialog.ready.title"),
      buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
      defaultId: 0,
      cancelId: 1,
    }),
  )
  if (response.response === 0) yield* install
})

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}
