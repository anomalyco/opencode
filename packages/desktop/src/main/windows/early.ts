import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, screen, shell } from "electron"
import { resolveExternalURL } from "../files/external-url"
import { windowArguments } from "./bootstrap"
import { WINDOW_IDS_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { platformFrame, storedBackgroundColor, storedZoomLevel, tone } from "./defaults"
import {
  initialEarlyWindowState,
  isEarlyWindowClosed,
  transitionEarlyWindow,
  type EarlyWindowCommand,
  type EarlyWindowEvent,
} from "./early-machine"
import { registerRendererProtocol } from "./protocol"
import { persistedWindowIDs } from "./registry"
import { loadWindow } from "./scheme"
import { allowRendererPermissions, wireNavigationPolicy, wireRendererHeaders } from "./security"
import {
  manageWindowState,
  readWindowState,
  resolveWindowState,
  windowStateFile,
  type WindowState,
} from "./window-state"

export type EarlyWindow = {
  readonly id: string
  readonly win: BrowserWindow
  readonly state: WindowState
  readonly shownAt: number
}

const current = { state: initialEarlyWindowState<EarlyWindow>() }

const dispatch = (event: EarlyWindowEvent<EarlyWindow>) => {
  const next = transitionEarlyWindow(current.state, event)
  current.state = next.state
  next.commands.forEach(perform)

  return next.commands
}

const perform = (command: EarlyWindowCommand<EarlyWindow>) => {
  if (command.type === "open-external-early") {
    const target = resolveExternalURL(command.url)

    if (target) void shell.openExternal(target)

    return
  }

  if (command.type === "open-external-adopted") return command.openExternal(command.url)

  if (command.type === "destroy-early") {
    if (!command.entry.win.isDestroyed()) command.entry.win.destroy()

    return
  }

  if (command.type === "quit") app.quit()
}

const displays = {
  all: () => screen.getAllDisplays().map((display) => display.bounds),
  primary: () => screen.getPrimaryDisplay().bounds,
  matching: (bounds: Electron.Rectangle) => screen.getDisplayMatching(bounds).bounds,
}

// Creates and shows the first restored window the moment Electron is ready, before the rest of the
// main process has loaded. The frame options mirror windowAppearance(); the persisted background
// colour stands in for the theme until the renderer applies it, so the window is on screen while the
// bundle, the layers and the renderer boot. restoreWindows() adopts it through restoreEarlyWindow().
export function createEarlyWindow() {
  const id = persistedWindowIDs(getStore().get(WINDOW_IDS_KEY))[0] ?? randomUUID()
  const root = path.dirname(fileURLToPath(import.meta.url))
  const file = path.join(app.getPath("userData"), windowStateFile(id))
  const state = resolveWindowState(readWindowState(file), { width: 1280, height: 800 }, displays)
  const zoom = storedZoomLevel()
  const icons = app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(root, "../../resources/icons")

  // On Windows, maximize() on a hidden window shows it with SW_SHOWMAXIMIZED, so it never paints at
  // its normal bounds first. macOS does not reliably enter fullscreen while hidden, so it shows first.
  const deferReveal = process.platform === "win32" && state.isMaximized

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: !deferReveal,
    autoHideMenuBar: true,
    title: "OpenCode",
    icon: path.join(icons, `icon.${process.platform === "win32" ? "ico" : "png"}`),
    backgroundColor: storedBackgroundColor(),
    ...platformFrame(tone(), zoom),
    webPreferences: {
      preload: path.join(root, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer boots in this window, so it starts at the saved zoom instead of jumping to it later.
      zoomFactor: zoom,
      additionalArguments: windowArguments(id),
    },
  })

  manageWindowState(win, file, state, displays)

  if (deferReveal) win.show()

  const entry: EarlyWindow = { id, win, state, shownAt: Date.now() }

  dispatch({ type: "early.created", id, entry })
  win.once("closed", () => dispatch({ type: "early.closed", entry }))
  // The renderer boots while the main bundle and layers load, instead of after them. Everything the
  // page needs before its first request is wired here; the IPC port arrives once the layers are up.
  registerRendererProtocol(path.join(root, "../renderer"))
  allowRendererPermissions(win)
  wireNavigationPolicy(win, (url) => dispatch({ type: "external.opened", entry, url }))
  wireRendererHeaders(win)
  loadWindow(win, "index.html")
}

/** The user closed the first window before the layers adopted it, so the app is quitting. */
export function earlyWindowClosed() {
  return isEarlyWindowClosed(current.state)
}

/**
 * Plans the windows to restore: the early window is adopted when its id is still persisted, and nothing is restored
 * once it closed. Its external links switch to `openExternal`.
 */
export function restoreEarlyWindow(input: {
  ids: readonly string[]
  fallbackId: string
  openExternal: (url: string) => void
}) {
  const pending = current.state.status === "pending" ? current.state.entry : undefined

  return dispatch({
    type: "restore.requested",
    ids: input.ids,
    fallbackId: input.fallbackId,
    destroyed: !!pending?.win.isDestroyed(),
    openExternal: input.openExternal,
  }).flatMap((command) => (command.type === "restore-windows" ? command.plan : []))
}
