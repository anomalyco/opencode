import { app, ipcMain } from "electron"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"

export function registerUpdaterIpc(controller: UpdaterController) {
  const subscriptions = createUpdaterSubscriptions()
  app.once("will-quit", subscriptions.clear)

  ipcMain.handle("updater-subscribe", (event) => {
    const id = event.sender.id
    subscriptions.set(
      id,
      controller.subscribe((state) => {
        if (event.sender.isDestroyed()) return subscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => subscriptions.delete(id))
  })
  ipcMain.handle("updater-unsubscribe", (event) => subscriptions.delete(event.sender.id))
  ipcMain.handle("updater-check", () => controller.check())
  ipcMain.handle("updater-install", () => controller.install())
}
