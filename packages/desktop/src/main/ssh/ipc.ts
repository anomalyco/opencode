import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { SshServersController } from "./servers"

export function registerSshIpcHandlers(controller: SshServersController) {
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  ipcMain.handle("ssh-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("ssh-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("ssh-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("ssh-servers-get-state", () => controller.getState())
  ipcMain.handle("ssh-servers-add", (_event: IpcMainInvokeEvent, config: unknown) => {
    if (!config || typeof config !== "object" || !("name" in config) || !("host" in config)) {
      throw new Error("Invalid SSH server config")
    }
    const c = config as Record<string, unknown>
    return controller.addServer({
      id: "",
      name: String(c.name),
      host: String(c.host),
      port: typeof c.port === "number" ? c.port : undefined,
      identityFile: typeof c.identityFile === "string" ? c.identityFile : undefined,
    })
  })
  ipcMain.handle("ssh-servers-remove", (_event: IpcMainInvokeEvent, id: string) => controller.removeServer(id))
  ipcMain.handle("ssh-servers-start", (_event: IpcMainInvokeEvent, id: string) => controller.startServer(id))
}
