import { app, dialog } from "electron"
import type { WebContents } from "electron"
import { Ipc, sendIpcEvent } from "../../shared/ipc-contract"
import { UPDATER_ENABLED } from "../constants"
import { getLogger } from "../native/logging"
import { nativeT } from "../native/translations"
import { getStore } from "../storage/store"
import { createUpdaterController, type UpdaterController, type UpdaterReadyRecord } from "./controller"

const key = "ready"

export async function setupAutoUpdater(prepareToRestart: () => Promise<void>) {
  const logger = getLogger()
  const store = getStore("opencode.updater")
  const platform = UPDATER_ENABLED ? (await import("./platform")).createUpdaterPlatform(logger) : undefined
  return createUpdaterController({
    currentVersion: app.getVersion(),
    platform,
    lifecycle: { prepareToRestart },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string")
          return undefined
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    log: (message, data) => logger.log(message, data),
  })
}

export function startAutoUpdater(controller: UpdaterController) {
  void controller.start()
  const timer = setInterval(() => void controller.check(), 10 * 60 * 1000)
  timer.unref()
  app.once("will-quit", () => clearInterval(timer))
}

export function createUpdaterIpc(controller: UpdaterController) {
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  }
  app.once("will-quit", () => subscriptions.forEach((dispose) => dispose()))

  return {
    subscribe(sender: WebContents) {
      const id = sender.id
      subscriptions.get(id)?.() // a reloaded renderer replaces its previous subscription
      subscriptions.set(
        id,
        controller.subscribe((state) => {
          if (sender.isDestroyed()) return unsubscribe(id)
          sendIpcEvent(sender, Ipc.updater.state, state)
        }),
      )
      sender.once("destroyed", () => unsubscribe(id))
    },
    unsubscribe,
    check: () => controller.check(),
    install: () => controller.install(),
  }
}

export type UpdaterIpc = ReturnType<typeof createUpdaterIpc>

export async function showUpdaterDialog(controller: UpdaterController) {
  const state = await controller.check()
  if (state.status === "error") {
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
