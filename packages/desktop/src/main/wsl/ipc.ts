import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { WslServersController } from "./servers"
import { requireWslIpcString } from "./policy"

export function registerWslIpcHandlers(controller: WslServersController) {
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

  ipcMain.handle("wsl-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("wsl-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("wsl-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("wsl-servers-get-state", () => controller.getState())
  ipcMain.handle("wsl-servers-probe-runtime", () => controller.probeRuntime())
  ipcMain.handle("wsl-servers-refresh-distros", () => controller.refreshDistros())
  ipcMain.handle("wsl-servers-install-wsl", () => controller.installWsl())
  ipcMain.handle("wsl-servers-install-distro", (_event: IpcMainInvokeEvent, name: string) =>
    controller.installDistro(requireWslIpcString("distro", name)),
  )
  ipcMain.handle("wsl-servers-probe-distro", (_event: IpcMainInvokeEvent, name: string) =>
    controller.probeDistro(requireWslIpcString("distro", name)),
  )
  ipcMain.handle("wsl-servers-probe-opencode", (_event: IpcMainInvokeEvent, name: string) =>
    controller.probeOpencode(requireWslIpcString("distro", name)),
  )
  ipcMain.handle("wsl-servers-install-opencode", (_event: IpcMainInvokeEvent, name: string) =>
    controller.installOpencode(requireWslIpcString("distro", name)),
  )
  ipcMain.handle("wsl-servers-open-terminal", (_event: IpcMainInvokeEvent, name: string) =>
    controller.openTerminal(requireWslIpcString("distro", name)),
  )
  ipcMain.handle("wsl-servers-add", (_event: IpcMainInvokeEvent, distro: string) =>
    controller.addServer(requireWslIpcString("distro", distro)),
  )
  ipcMain.handle("wsl-servers-remove", (_event: IpcMainInvokeEvent, id: string) =>
    controller.removeServer(requireWslIpcString("server id", id)),
  )
  ipcMain.handle("wsl-servers-start", (_event: IpcMainInvokeEvent, id: string) =>
    controller.startServer(requireWslIpcString("server id", id)),
  )
}
