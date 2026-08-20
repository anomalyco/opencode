import windowState from "electron-window-state"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow } from "electron"
import { writeLog } from "../native/logging"
import { removeStoreFile, getStore } from "../storage/store"
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
  cleanup: (id) => {
    rmSync(join(app.getPath("userData"), windowStateFile(id)), { force: true })
    removeStoreFile(windowDataFile(id))
  },
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
  relaunchHandler = handler
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

export function restoreMainWindows() {
  const ids = registry.persisted()
  return (ids.length ? ids : [randomUUID()]).map((id) => createMainWindow(id))
}

export function createMainWindow(id: string = randomUUID()) {
  const state = windowState({ file: windowStateFile(id), defaultWidth: 1280, defaultHeight: 800 })
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    ...windowAppearance(),
  })

  allowRendererPermissions(win)
  wireWindowRecovery(win, id, () => relaunchHandler())
  wireNavigationPolicy(win)
  wireRendererHeaders(win)
  state.manage(win)
  registerWindow(win, id)
  wireFullscreen(win)
  wireZoom(win)
  let contentReady = false
  let appliedTheme = false
  let revealed = false
  const reveal = () => {
    if (!contentReady || !appliedTheme || revealed || win.isDestroyed()) return
    revealed = true
    win.show()
    writeLog("window", "main window visible", { window: id })
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
  loadWindow(win, "index.html")
  return win
}

function registerWindow(win: BrowserWindow, id: string) {
  windowIDs.set(win, id)
  registry.register(id, win)
  win.on("focus", () => registry.focused(id))
  // Windows emits session-end, but not before-quit, during shutdown and logoff.
  win.on("session-end", () => registry.setQuitting())
  win.on("closed", () => registry.closed(id))
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
