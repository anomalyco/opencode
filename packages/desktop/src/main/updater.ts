import { app, dialog, ipcMain } from "electron"
import { UPDATER_ENABLED } from "./constants"
import { createUpdaterController, type UpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { nativeT } from "./native-translations"
import { createUpdaterPlatform } from "./updater-platform"

const key = "ready"

export function setupAutoUpdater(prepareToRestart: () => Promise<void>) {
  const logger = getLogger()
  const store = getStore("opencode.updater")
  return createUpdaterController({
    currentVersion: app.getVersion(),
    platform: UPDATER_ENABLED ? createUpdaterPlatform(logger) : undefined,
    lifecycle: { prepareToRestart },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    log: (message, data) => logger.log(message, data),
  })
}

export function registerUpdaterIpc(controller: UpdaterController) {
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  }
  app.once("will-quit", () => subscriptions.forEach((dispose) => dispose()))

  ipcMain.handle("updater-subscribe", (event) => {
    const id = event.sender.id
    subscriptions.get(id)?.() // a reloaded renderer replaces its previous subscription
    subscriptions.set(
      id,
      controller.subscribe((state) => {
        if (event.sender.isDestroyed()) return unsubscribe(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("updater-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("updater-check", () => controller.check())
  ipcMain.handle("updater-install", () => controller.install())
}

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
