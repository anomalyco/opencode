import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { SshServersController } from "./servers"
import { requireSshIpcString } from "./policy"

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
  ipcMain.handle("ssh-servers-refresh-config-hosts", () => controller.refreshConfigHosts())
  ipcMain.handle("ssh-servers-probe-host", (_event: IpcMainInvokeEvent, host: string) =>
    controller.probeHost(requireSshIpcString("host", host)),
  )
  ipcMain.handle("ssh-servers-install-opencode", (_event: IpcMainInvokeEvent, host: string) =>
    controller.installOpencode(requireSshIpcString("host", host)),
  )
  ipcMain.handle("ssh-servers-open-terminal", (_event: IpcMainInvokeEvent, host: string) =>
    controller.openTerminal(requireSshIpcString("host", host)),
  )
  ipcMain.handle("ssh-servers-add", (_event: IpcMainInvokeEvent, host: string) =>
    controller.addServer(requireSshIpcString("host", host)),
  )
  ipcMain.handle("ssh-servers-remove", (_event: IpcMainInvokeEvent, id: string) =>
    controller.removeServer(requireSshIpcString("server id", id)),
  )
  ipcMain.handle("ssh-servers-start", (_event: IpcMainInvokeEvent, id: string) =>
    controller.startServer(requireSshIpcString("server id", id)),
  )
  ipcMain.handle("ssh-servers-stop", (_event: IpcMainInvokeEvent, id: string) =>
    controller.stopServer(requireSshIpcString("server id", id)),
  )
}
