export * as Ipc from "./ipc"

import { app, BrowserWindow, MessageChannelMain, webContents } from "electron"
import { Effect, Layer } from "effect"
import { RpcServer } from "effect/rpc"
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
import { runDesktopMenuAction } from "./native/menu-actions"
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

  // Every webContents has its own keyboard stream; embedded views (for example the browser panel)
  // need F11 handled too, otherwise the hidden default menu's native-fullscreen accelerator still
  // fires there. Windows maximizes instead so the taskbar stays reachable (#54714).
  const onWebContentsCreated = (_event: Electron.Event | undefined, contents: Electron.WebContents) => {
    if (process.platform !== "win32") return
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "F11") return

      event.preventDefault()

      if (input.isAutoRepeat) return

      const win = getLastFocusedWindow()

      if (win) runDesktopMenuAction(win, "window.toggleMaximize")
    })
  }

  yield* Effect.sync(() => {
    app.on("browser-window-created", onWindowCreated)
    app.on("web-contents-created", onWebContentsCreated)
    BrowserWindow.getAllWindows().forEach((win) => wire(win))
    webContents.getAllWebContents().forEach((contents) => onWebContentsCreated(undefined, contents))
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      app.off("browser-window-created", onWindowCreated)
      app.off("web-contents-created", onWebContentsCreated)
    }),
  )

  return {
    installMenu: () => createMenu(menu),
  }
})
