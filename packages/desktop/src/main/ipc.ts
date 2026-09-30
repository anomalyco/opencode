export * as Ipc from "./ipc"

import { app, BrowserWindow, MessageChannelMain } from "electron"
import { Effect, Layer, Queue } from "effect"
import { RpcServer } from "effect/unstable/rpc"
import { DesktopRpcs } from "../shared/ipc-rpc"
import { DragCancelEvent, IpcTransportPort } from "../shared/ipc-transport"
import { DesktopFiles, openExternalURL } from "./files"
import { appHandlers } from "./ipc-handlers/app"
import { eventHandlers } from "./ipc-handlers/events"
import { fileHandlers } from "./ipc-handlers/files"
import { menuHandlers } from "./ipc-handlers/menu"
import { storageHandlers } from "./ipc-handlers/storage"
import { updaterHandlers } from "./ipc-handlers/updater"
import { windowHandlers } from "./ipc-handlers/window"
import { wslHandlers } from "./ipc-handlers/wsl"
import { sshHandlers } from "./ipc-handlers/ssh"
import { Ssh } from "./ssh/service"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"
import { ApplicationLifecycle } from "./lifecycle"
import { showCliInstaller } from "./native/install-cli"
import { createMenu, menuCommands, sendMenuCommand } from "./native/menu"
import { getTrayEnabled, setTraySessions, startTray, syncTrayTabs } from "./native/tray"
import { trayTabs } from "./native/tray-tabs"
import { loadTraySessions } from "./native/tray-sessions"
import { BackgroundService } from "./service/background-service"
import { DesktopCli } from "./service/desktop-cli"
import { Updater } from "./updater"
import { getLastFocusedWindow } from "./windows"
import { Wsl } from "./wsl/start"

const services = Layer.mergeAll(DesktopFiles.layer, Wsl.layer, Ssh.layer)
const handlers = Layer.mergeAll(
  appHandlers,
  storageHandlers,
  fileHandlers,
  windowHandlers,
  menuHandlers,
  updaterHandlers,
  wslHandlers,
  sshHandlers,
  eventHandlers,
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
  const updater = yield* Updater.Service
  const background = yield* BackgroundService.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const menu = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => runFork(updater.show),
    installCli: () => runFork(showCliInstaller(desktopCli)),
    createWindow: lifecycle.createWindow,
    openExternal: (url: string) => runFork(openExternalURL(url)),
    relaunch: lifecycle.relaunch,
  }
  const wire = (_event: Electron.Event, win: BrowserWindow) => {
    win.once("closed", () => trayTabs.remove(win.id))
    win.webContents.on("did-start-loading", () => menuCommands.reset(win))
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return
      if (
        process.platform !== "darwin" &&
        input.key.toLowerCase() === "q" &&
        input.control &&
        !input.meta &&
        !input.alt &&
        !input.shift
      ) {
        event.preventDefault()
        app.quit()
        return
      }
      if (input.key !== "Escape") return
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
  yield* Effect.sync(() => {
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire({} as Electron.Event, win))
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => app.off("browser-window-created", wire)))
  const { createTrayIcons } = yield* Effect.promise(() => import("./native/tray-icons"))
  const icons = yield* Effect.promise(createTrayIcons)
  const stopTray = startTray(
    {
      open: () => menuCommands.trigger(lifecycle.showWindow(), { type: "home" }),
      trigger: (id) => sendMenuCommand(lifecycle.showWindow(), id),
      session: (sessionID) => {
        const owner = trayTabs.owner(sessionID, getLastFocusedWindow()?.id)
        const win = owner === undefined ? undefined : BrowserWindow.fromId(owner)
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        menuCommands.trigger(win, { type: "session", sessionID })
      },
      docs: () => menu.openExternal("https://opencode.ai/v2/docs/"),
      quit: () => app.quit(),
    },
    icons,
  )
  yield* Effect.addFinalizer(() => Effect.sync(stopTray))
  const refresh = yield* Queue.sliding<void>(1)
  const unsubscribe = trayTabs.subscribe(() => {
    syncTrayTabs()
    Queue.offerUnsafe(refresh, undefined)
  })
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
  yield* Queue.offer(refresh, undefined)
  yield* Effect.gen(function* () {
    yield* Queue.take(refresh).pipe(Effect.timeoutOption("10 seconds"))
    if (!getTrayEnabled()) return
    const sessionIDs = trayTabs.sessions()
    if (!sessionIDs.length) {
      syncTrayTabs()
      return
    }
    const connection = yield* background.connection
    const { OpenCode } = yield* Effect.promise(() => import("@opencode/client"))
    const client = OpenCode.make({
      baseUrl: connection.url,
      headers: connection.password
        ? { authorization: `Basic ${Buffer.from(`opencode:${connection.password}`).toString("base64")}` }
        : undefined,
    })
    const snapshot = yield* Effect.tryPromise((signal) =>
      loadTraySessions(client, sessionIDs, AbortSignal.any([signal, AbortSignal.timeout(15_000)])),
    )
    yield* Effect.promise((signal) =>
      icons.prepare(
        snapshot.sessions.map((session) => ({ ...session, avatar: trayTabs.avatar(session.id) })),
        AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      ),
    )
    setTraySessions(snapshot)
  }).pipe(
    Effect.catch(() => Effect.sync(() => setTraySessions())),
    Effect.forever,
    Effect.forkScoped,
  )
  return {
    installMenu: () => createMenu(menu),
  }
})
