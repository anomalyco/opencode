import { randomUUID } from "node:crypto"
import { app, BrowserWindow, screen } from "electron"
import { Effect, FileSystem, Path } from "effect"
import { openExternalURL } from "../files"
import { scoped } from "../native/logging"
import { DesktopPaths } from "../paths"
import { DesktopStorage } from "../storage"
import { getStore } from "../storage/store"
import { WINDOW_IDS_KEY } from "../storage/keys"
import { windowDataFile } from "../../shared/ipc-transport"
import { windowArguments } from "./bootstrap"
import {
  getBackgroundColor,
  getPinchZoomEnabled,
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTitlebar,
  setZoomFactor,
  updateTitlebar,
  windowAppearance,
  wireFullscreen,
  wireZoom,
} from "./appearance"
import { registerRendererProtocol, setProtocolReporter } from "./protocol"
import { loadWindow } from "./scheme"
import { createWindowRegistry } from "./registry"
import { makeWindowRecovery } from "./recovery"
import { takeEarlyWindow, type EarlyWindow } from "./early"
import { manageWindowState, readWindowState, resolveWindowState, windowStateFile } from "./window-state"
import { allowRendererPermissions, wireNavigationPolicy, wireRendererHeaders } from "./security"

const themeReady = new WeakMap<BrowserWindow, () => void>()
const displays = {
  all: () => screen.getAllDisplays().map((display) => display.bounds),
  primary: () => screen.getPrimaryDisplay().bounds,
  matching: (bounds: Electron.Rectangle) => screen.getDisplayMatching(bounds).bounds,
}
const registry = createWindowRegistry<BrowserWindow>({
  read: () => getStore().get(WINDOW_IDS_KEY),
  write: (ids) => getStore().set(WINDOW_IDS_KEY, ids),
})
let relaunchHandler = () => {
  setAppQuitting()
  app.relaunch()
  app.exit(0)
}

export {
  getBackgroundColor,
  getPinchZoomEnabled,
  registerRendererProtocol,
  setProtocolReporter,
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTitlebar,
  setZoomFactor,
  updateTitlebar,
}

export function setRelaunchHandler(handler: () => void) {
  const previous = relaunchHandler
  relaunchHandler = handler
  return () => {
    if (relaunchHandler === handler) relaunchHandler = previous
  }
}

export function setAppQuitting(quitting = true) {
  registry.setQuitting(quitting)
}

export function getLastFocusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return focused
  const win = registry.lastFocused()
  if (!win || win.isDestroyed()) return null
  return win
}

export function getWindowByID(id: string) {
  const win = registry.get(id)
  if (!win || win.isDestroyed()) return null
  return win
}

export function setWindowThemeReady(win: BrowserWindow) {
  themeReady.get(win)?.()
}

export const makeMainWindows = Effect.fn("Window.make")(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const storage = yield* DesktopStorage.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const wireWindowRecovery = yield* makeWindowRecovery

  const restore = () => {
    // The entry module created and showed the first restored window on ready; it is adopted here,
    // before any renderer loads, so the user never waited for the layers to see a window.
    const early = takeEarlyWindow()
    const usable = early && !early.win.isDestroyed() ? early : undefined
    const ids = registry.persisted()
    const list = ids.length ? ids : [usable?.id ?? randomUUID()]
    if (usable && !list.includes(usable.id)) usable.win.destroy()
    return list.map((id) => create(id, usable?.id === id ? usable : undefined))
  }

  const create = (id: string = randomUUID(), early?: EarlyWindow) => {
    const stateFile = path.join(app.getPath("userData"), windowStateFile(id))
    const state = early?.state ?? resolveWindowState(readWindowState(stateFile), { width: 1280, height: 800 }, displays)
    const appearance = windowAppearance(path, paths)
    const win =
      early?.win ??
      new BrowserWindow({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        show: false,
        autoHideMenuBar: true,
        ...appearance,
        webPreferences: {
          ...appearance.webPreferences,
          additionalArguments: windowArguments(id),
        },
      })

    // The early window was secured and loaded when it was created; only its external-URL policy is
    // upgraded to the logged one.
    if (early) early.openExternal = (url) => runFork(openExternalURL(url))
    if (!early) {
      allowRendererPermissions(win)
      wireNavigationPolicy(win, (url) => runFork(openExternalURL(url)))
      wireRendererHeaders(win)
      manageWindowState(win, stateFile, state, displays)
    }
    wireWindowRecovery(win, id, () => relaunchHandler())
    register(win, id)
    wireFullscreen(win)
    if (!early) loadWindow(win, "index.html")
    wireZoom(win)
    let contentReady = false
    let appliedTheme = false
    let revealed = !!early
    const focusForTests = () => {
      if (app.isPackaged || process.env.OPENCODE_TEST_ONBOARDING !== "1") return
      if (process.platform === "darwin") app.focus({ steal: true })
      win.focus()
    }
    if (early) {
      focusForTests()
      runFork(Effect.logInfo("main window visible", { window: id, shownAt: early.shownAt }))
    }
    const reveal = () => {
      if (!contentReady || !appliedTheme || revealed || win.isDestroyed()) return
      revealed = true
      win.show()
      focusForTests()
      runFork(Effect.logInfo("main window visible", { window: id }))
    }
    const ready = () => {
      contentReady = true
      reveal()
    }
    themeReady.set(win, () => {
      appliedTheme = true
      reveal()
    })
    win.once("ready-to-show", ready)
    if (process.platform === "linux") win.webContents.once("did-finish-load", ready)
    win.once("closed", () => themeReady.delete(win))
    return win
  }

  const register = (win: BrowserWindow, id: string) => {
    registry.register(id, win)
    win.on("focus", () => registry.focused(id))
    // Windows emits session-end, but not before-quit, during shutdown and logoff.
    win.on("session-end", () => registry.setQuitting())
    win.on("closed", () => {
      if (!registry.closed(id)) return
      runFork(
        Effect.gen(function* () {
          yield* Effect.try(() => storage.state.clear(windowDataFile(id)))
          yield* fs.remove(path.join(app.getPath("userData"), windowStateFile(id)), { force: true })
        }).pipe(
          Effect.catch((error) => scoped("window", Effect.logError("failed to clean window state", { id, error }))),
        ),
      )
    })
  }

  return { create, restore }
})


