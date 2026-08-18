import { app, BrowserWindow, MessageChannelMain } from "electron"
import { Layer, ManagedRuntime } from "effect"
import { RpcServer } from "effect/unstable/rpc"
import { DesktopRpcs } from "../shared/ipc-rpc"
import { IpcTransportPort } from "../shared/ipc-transport"
import { createFileCapabilities } from "./files"
import { appHandlers, type AppHandlerDeps } from "./ipc-handlers/app"
import { eventHandlers } from "./ipc-handlers/events"
import { fileHandlers } from "./ipc-handlers/files"
import { menuHandlers } from "./ipc-handlers/menu"
import { storageHandlers } from "./ipc-handlers/storage"
import { updaterHandlers } from "./ipc-handlers/updater"
import { windowHandlers } from "./ipc-handlers/window"
import { wslHandlers } from "./ipc-handlers/wsl"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"
import { createDesktopStorage } from "./storage"
import type { UpdaterIpc } from "./updater"
import type { WslIpc } from "./wsl/ipc"

type Deps = AppHandlerDeps & {
  showUpdater: () => Promise<void> | void
}

export async function registerIpcHandlers(deps: Deps, updater: UpdaterIpc, wsl: WslIpc) {
  const handlers = Layer.mergeAll(
    appHandlers(deps),
    storageHandlers(createDesktopStorage()),
    fileHandlers(createFileCapabilities()),
    windowHandlers,
    menuHandlers(deps),
    updaterHandlers(updater),
    wslHandlers(wsl),
    eventHandlers,
  )
  const live = RpcServer.layer(DesktopRpcs, { disableFatalDefects: true }).pipe(
    Layer.provide(handlers),
    Layer.provideMerge(IpcServerProtocolLive),
  )
  const runtime = ManagedRuntime.make(live)
  const handoff = await runtime.runPromise(IpcPortHandoff)
  const wire = (_event: Electron.Event, win: BrowserWindow) => {
    win.webContents.on("did-finish-load", () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      const channel = new MessageChannelMain()
      handoff.bind(win.webContents, channel.port1)
      win.webContents.postMessage(IpcTransportPort, null, [channel.port2])
    })
  }
  app.on("browser-window-created", wire)
  BrowserWindow.getAllWindows().forEach((win) => wire({} as Electron.Event, win))
  app.once("will-quit", () => {
    app.off("browser-window-created", wire)
    void runtime.dispose()
  })
}
