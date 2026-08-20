export * as Updater from "./index"

import { app, dialog } from "electron"
import type { WebContents } from "electron"
import { Context, Effect, Layer } from "effect"
import type { UpdaterState } from "@opencode-ai/app/updater"
import { UpdaterStateChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { UPDATER_ENABLED } from "../constants"
import { ApplicationLifecycle } from "../lifecycle"
import { nativeT } from "../native/translations"
import { getStore } from "../storage/store"
import { createUpdaterController, type UpdaterReadyRecord } from "./controller"
import { createUpdaterPlatform } from "./platform"

const key = "ready"

export interface Interface {
  readonly subscribe: (sender: WebContents) => Effect.Effect<void>
  readonly unsubscribe: (id: number) => Effect.Effect<void>
  readonly check: Effect.Effect<UpdaterState>
  readonly install: Effect.Effect<void>
  readonly show: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Updater") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* ApplicationLifecycle.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const store = getStore("opencode.updater")
    const platform = UPDATER_ENABLED ? createUpdaterPlatform(runFork) : undefined
    const controller = createUpdaterController({
      currentVersion: app.getVersion(),
      platform,
      lifecycle: { prepareToRestart: () => Effect.runPromiseWith(context)(lifecycle.prepareToRestart) },
      persistence: {
        get() {
          const value = store.get(key)
          if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
          return { version: value.version } satisfies UpdaterReadyRecord
        },
        set: (value) => store.set(key, value),
        clear: () => store.delete(key),
      },
      log: (message, data) => runFork(Effect.logInfo(message, data)),
    })
    const subscriptions = new Map<number, () => void>()
    const unsubscribe = (id: number) => {
      subscriptions.get(id)?.()
      subscriptions.delete(id)
    }
    yield* promise(() => controller.start()).pipe(Effect.forkScoped)
    yield* Effect.gen(function* () {
      yield* Effect.sleep("10 minutes")
      yield* promise(() => controller.check())
    }).pipe(Effect.forever, Effect.forkScoped)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        platform?.dispose()
        subscriptions.forEach((dispose) => dispose())
        subscriptions.clear()
      }),
    )

    return Service.of({
      subscribe: (sender) =>
        Effect.sync(() => {
          const id = sender.id
          subscriptions.get(id)?.()
          subscriptions.set(
            id,
            controller.subscribe((state) => {
              if (sender.isDestroyed()) return unsubscribe(id)
              emitIpcEvent(sender, new UpdaterStateChanged({ state }))
            }),
          )
          sender.once("destroyed", () => unsubscribe(id))
        }),
      unsubscribe: (id) => Effect.sync(() => unsubscribe(id)),
      check: promise(() => controller.check()),
      install: promise(() => controller.install()),
      show: show(controller),
    })
  }),
)

const show = Effect.fn("Updater.show")(function* (controller: ReturnType<typeof createUpdaterController>) {
  const state = yield* promise(() => controller.check())
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
  if (response.response === 0) yield* promise(() => controller.install())
})

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}
