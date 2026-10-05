export * as Ipc from "./ipc"

import { app, BrowserWindow, MessageChannelMain } from "electron"
import { Effect, Layer } from "effect"
import { RpcServer } from "effect/unstable/rpc"
import { DesktopRpcs } from "../shared/ipc-rpc"
import { DragCancelEvent, IpcTransportPort } from "../shared/ipc-transport"
import { Extensions } from "./extension"
import { DesktopFiles, openExternalURL } from "./files"
import { appHandlers } from "./ipc-handlers/app"
import { eventHandlers } from "./ipc-handlers/events"
import { extensionHandlers } from "./ipc-handlers/extensions"
import { fileHandlers } from "./ipc-handlers/files"
import { menuHandlers } from "./ipc-handlers/menu"
import { storageHandlers } from "./ipc-handlers/storage"
import { windowHandlers } from "./ipc-handlers/window"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"
import { ApplicationLifecycle } from "./lifecycle"
import { showCliInstaller } from "./native/install-cli"
import { createMenu, sendMenuCommand } from "./native/menu"
import { DesktopCli } from "./service/desktop-cli"
import { getLastFocusedWindow } from "./windows"

const services = Layer.mergeAll(DesktopFiles.layer, Extensions.layer)

const handlers = Layer.mergeAll(
  appHandlers,
  storageHandlers,
  fileHandlers,
  windowHandlers,
  menuHandlers,
  eventHandlers,
  extensionHandlers,
)

export const layer = RpcServer.layer(DesktopRpcs, { disableFatalDefects: true }).pipe(
  Layer.provide(handlers),
  Layer.provideMerge(IpcServerProtocolLive),
  Layer.provideMerge(services),
)

export const registerIpcHandlers = Effect.gen(function* () {
  const handoff = yield* IpcPortHandoff
  const lifecycle = yield* ApplicationLifecycle.Service
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context())

  const menu = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()

      if (win) sendMenuCommand(win, id)
    },
    installCli: () => runFork(showCliInstaller(desktopCli)),
    createWindow: lifecycle.createWindow,
    openExternal: (url: string) => runFork(openExternalURL(url)),
    relaunch: lifecycle.relaunch,
  }

  const wire = (win: BrowserWindow) => {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape") return
      win.webContents.send(DragCancelEvent)
    })

    const post = () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      const channel = new MessageChannelMain()
      handoff.bind(win.webContents, channel.port1)
      win.webContents.postMessage(IpcTransportPort, null, [channel.port2])
    }

    win.webContents.on("did-finish-load", post)

    // The first window starts loading before the layers exist and may already be done.
    if (!win.webContents.isLoading() && win.webContents.getURL()) post()
  }

  const onWindowCreated = (_event: Electron.Event, win: BrowserWindow) => wire(win)

  yield* Effect.sync(() => {
    app.on("browser-window-created", onWindowCreated)
    BrowserWindow.getAllWindows().forEach((win) => wire(win))
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => app.off("browser-window-created", onWindowCreated)))

  return {
    installMenu: () => createMenu(menu),
  }
})
