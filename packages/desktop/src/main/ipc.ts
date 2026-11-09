export * as Ipc from "./ipc"

import { app, BrowserWindow, MessageChannelMain } from "electron"
import { Effect, Layer } from "effect"
import { RpcServer } from "effect/rpc"
import { DesktopRpcs } from "../shared/ipc-rpc"
import { DragCancelEvent, IpcTransportPort } from "../shared/ipc-transport"
import { Plugins } from "./plugin"
import { DesktopFiles, openExternalURL } from "./files"
import { appHandlers } from "./ipc-handlers/app"
import { eventHandlers } from "./ipc-handlers/events"
import { pluginHandlers } from "./ipc-handlers/plugins"
import { fileHandlers } from "./ipc-handlers/files"
import { menuHandlers } from "./ipc-handlers/menu"
import { storageHandlers } from "./ipc-handlers/storage"
import { windowHandlers } from "./ipc-handlers/window"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"
import { ApplicationLifecycle } from "./lifecycle"
import { createCliInstaller } from "./native/install-cli"
import { createMenu, disposeMenu, refreshMenu } from "./native/menu"
import { onNativeTranslations } from "./native/translations"
import { DesktopCli } from "./service/desktop-cli"
import { setStorageSnapshotObserver } from "./storage/snapshot"
import { getLastFocusedWindow } from "./windows"
import { isRendererUrl } from "./windows/scheme"

const services = Layer.mergeAll(DesktopFiles.layer, Plugins.layer)

const handlers = Layer.mergeAll(
  appHandlers,
  storageHandlers,
  fileHandlers,
  windowHandlers,
  menuHandlers,
  eventHandlers,
  pluginHandlers,
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
    commandWindow: getLastFocusedWindow,
    installCli: yield* createCliInstaller(desktopCli),
    createWindow: lifecycle.createWindow,
    openExternal: (url: string) => runFork(openExternalURL(url)),
    relaunch: lifecycle.relaunch,
  }

  const wire = (win: BrowserWindow) => {
    win.webContents.on("before-input-event", (_event, input) => {
      // Ctrl+R renames the session in the renderer, so the default menu's Reload must not take it.
      win.webContents.setIgnoreMenuShortcuts(
        input.control && !input.meta && !input.shift && !input.alt && input.key.toLowerCase() === "r",
      )

      if (input.type !== "keyDown" || input.key !== "Escape") return
      win.webContents.send(DragCancelEvent)
    })

    const post = () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      const channel = new MessageChannelMain()
      handoff.bind(win.webContents, channel.port1)
      win.webContents.postMessage(IpcTransportPort, null, [channel.port2])
    }

    // A committed document replaces the bound one; its events wait for the port posted when it loads.
    win.webContents.on("did-navigate", (_event, url) => {
      if (isRendererUrl(url)) handoff.prepare(win.webContents)
    })
    win.webContents.on("did-finish-load", post)

    // The first window starts loading before the layers exist and may already be done.
    if (!win.webContents.isLoading() && win.webContents.getURL()) post()
  }

  const onWindowCreated = (_event: Electron.Event, win: BrowserWindow) => wire(win)
  const stopDisconnects = handoff.onDisconnect(lifecycle.deepLinks.disconnect)
  yield* Effect.addFinalizer(() => Effect.sync(stopDisconnects))
  const stopSnapshots = setStorageSnapshotObserver(handoff.prepare)
  yield* Effect.addFinalizer(() => Effect.sync(stopSnapshots))
  // A language the renderer pushes rebuilds the menu once it is installed.
  const stopTranslations = onNativeTranslations(refreshMenu)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopTranslations()
      disposeMenu()
    }),
  )

  yield* Effect.sync(() => {
    app.on("browser-window-created", onWindowCreated)
    BrowserWindow.getAllWindows().forEach((win) => wire(win))
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => app.off("browser-window-created", onWindowCreated)))

  return {
    installMenu: () => createMenu(menu),
  }
})
