import windowState from "electron-window-state"
import { randomUUID } from "node:crypto"
import { app, BrowserWindow } from "electron"
import { Effect } from "effect"
import type { FileSystem, Path } from "effect"
import { openExternalURL } from "../files"
import { scoped } from "../native/logging"
import type { DesktopPaths } from "../paths"
import { forgetStore, getStore } from "../storage/store"
import { WINDOW_IDS_KEY } from "../storage/keys"
import {
  getBackgroundColor,
  getPinchZoomEnabled,
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
  windowAppearance,
  wireFullscreen,
  wireZoom,
} from "./appearance"
import { loadWindow, registerRendererProtocol } from "./protocol"
import { createWindowRegistry } from "./registry"
import { wireWindowRecovery } from "./recovery"
import { allowRendererPermissions, wireNavigationPolicy, wireRendererHeaders } from "./security"

const windowIDs = new WeakMap<BrowserWindow, string>()
const themeReady = new WeakMap<BrowserWindow, () => void>()
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
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTitlebar,
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

export function getWindowID(win: BrowserWindow) {
  return windowIDs.get(win)
}

export function getLastFocusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return focused
  const win = registry.lastFocused()
  if (!win || win.isDestroyed()) return null
  return win
}

export function setWindowThemeReady(win: BrowserWindow) {
  themeReady.get(win)?.()
}

export interface Dependencies {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly paths: DesktopPaths.Resolved
  readonly runFork: (effect: Effect.Effect<void>) => unknown
  readonly exportDebug: () => Promise<string>
}

export function restoreMainWindows(deps: Dependencies) {
  const ids = registry.persisted()
  return (ids.length ? ids : [randomUUID()]).map((id) => createMainWindow(deps, id))
}

export function createMainWindow(deps: Dependencies, id: string = randomUUID()) {
  const state = windowState({ file: windowStateFile(id), defaultWidth: 1280, defaultHeight: 800 })
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    ...windowAppearance(deps.path, deps.paths),
  })

  allowRendererPermissions(win)
  wireWindowRecovery(win, id, () => relaunchHandler(), deps.exportDebug)
  wireNavigationPolicy(win, (url) => deps.runFork(openExternalURL(url)))
  wireRendererHeaders(win)
  state.manage(win)
  registerWindow(deps, win, id)
  wireFullscreen(win)
  loadWindow(win, "index.html")
  wireZoom(win)
  let contentReady = false
  let appliedTheme = false
  let revealed = false
  const reveal = () => {
    if (!contentReady || !appliedTheme || revealed || win.isDestroyed()) return
    revealed = true
    win.show()
    Effect.runFork(Effect.logInfo("main window visible", { window: id }))
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

function registerWindow(deps: Dependencies, win: BrowserWindow, id: string) {
  windowIDs.set(win, id)
  registry.register(id, win)
  win.on("focus", () => registry.focused(id))
  // Windows emits session-end, but not before-quit, during shutdown and logoff.
  win.on("session-end", () => registry.setQuitting())
  win.on("closed", () => {
    if (!registry.closed(id)) return
    const data = windowDataFile(id)
    deps.runFork(
      Effect.gen(function* () {
        yield* deps.fs.remove(deps.path.join(app.getPath("userData"), windowStateFile(id)), { force: true })
        yield* deps.fs.remove(deps.path.join(app.getPath("userData"), data), { force: true })
      }).pipe(
        Effect.tap(() => Effect.sync(() => forgetStore(data))),
        Effect.catch((error) => scoped("window", Effect.logError("failed to clean window files", { id, error }))),
      ),
    )
  })
}

function windowStateFile(id: string) {
  return `window-state-${safeWindowID(id)}.json`
}

// Mirrors windowStorage() in packages/app/src/utils/persist.ts.
function windowDataFile(id: string) {
  return `opencode.window.${safeWindowID(id)}.dat`
}

function safeWindowID(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-")
}
