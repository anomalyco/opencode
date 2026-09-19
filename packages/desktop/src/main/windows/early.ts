import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, screen } from "electron"
import { windowIDArgument } from "../../shared/window-bootstrap"
import { WINDOW_IDS_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { storedBackgroundColor, titlebarOverlay } from "./defaults"
import { manageWindowState, readWindowState, resolveWindowState, windowStateFile, type WindowState } from "./window-state"

export type EarlyWindow = { id: string; win: BrowserWindow; state: WindowState; shownAt: number }

let pending: EarlyWindow | undefined

const displays = {
  all: () => screen.getAllDisplays().map((display) => display.bounds),
  primary: () => screen.getPrimaryDisplay().bounds,
  matching: (bounds: Electron.Rectangle) => screen.getDisplayMatching(bounds).bounds,
}

// Creates and shows the first restored window the moment Electron is ready, before the rest of the
// main process has loaded. The frame options mirror windowAppearance(); the persisted background
// colour stands in for the theme until the renderer applies it, so the window is on screen while the
// bundle, the layers and the renderer boot. restoreWindows() adopts it through takeEarlyWindow().
export function createEarlyWindow() {
  const ids = getStore().get(WINDOW_IDS_KEY)
  const id = Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : randomUUID()
  const root = path.dirname(fileURLToPath(import.meta.url))
  const file = path.join(app.getPath("userData"), windowStateFile(id))
  const state = resolveWindowState(readWindowState(file), { width: 1280, height: 800 }, displays)
  const icons = app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(root, "../../resources/icons")
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: true,
    autoHideMenuBar: true,
    title: "OpenCode",
    icon: path.join(icons, `icon.${process.platform === "win32" ? "ico" : "png"}`),
    backgroundColor: storedBackgroundColor(),
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 14, y: 14 } } : {}),
    ...(process.platform === "win32" ? { frame: false, titleBarStyle: "hidden" as const, titleBarOverlay: titlebarOverlay() } : {}),
    webPreferences: {
      preload: path.join(root, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [windowIDArgument(id)],
    },
  })
  manageWindowState(win, file, state, displays)
  // Closing the only window before the rest of the app has adopted it is a quit.
  win.once("closed", () => {
    if (pending?.win !== win) return
    pending = undefined
    app.quit()
  })
  pending = { id, win, state, shownAt: Date.now() }
}

export function takeEarlyWindow() {
  const taken = pending
  pending = undefined
  return taken
}
