import { randomUUID } from "node:crypto"
import { app, BrowserWindow, nativeTheme, screen } from "electron"
import { Effect, FileSystem, Path } from "effect"
import { openExternalURL } from "../files"
import { scoped } from "../native/logging"
import { keepsAppInTray } from "../native/tray"
import { DesktopPaths } from "../paths"
import { DesktopStorage } from "../storage"
import { getStore } from "../storage/store"
import { WINDOW_IDS_KEY } from "../storage/keys"
import { windowDataFile } from "../../shared/ipc-transport"
import { isQuitting, type State } from "../lifecycle/machine"
import { windowArguments } from "./bootstrap"
import { createClosePrompt, needsTrayCloseDecision } from "./close"
import {
  getBackgroundColor,
  getPinchZoomEnabled,
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTitlebar,
  setTrafficLightsPosition,
  setZoomLevel,
  updateTitlebar,
  windowAppearance,
  wireFocus,
  wireFullscreen,
  wireZoom,
} from "./appearance"
import { registerRendererProtocol, setProtocolReporter } from "./protocol"
import { loadWindow } from "./scheme"
import { createWindowRegistry } from "./registry"
import { windowRecovery } from "./recovery"
import { createRevealDriver } from "./reveal-machine"
import { restoreEarlyWindow, type EarlyWindow } from "./early"
import { manageWindowState, readWindowState, resolveWindowState, windowStateFile } from "./window-state"
import { refreshTaskbarBadge, setTaskbarBadge } from "./taskbar-badge"
import { setTaskbarProgress } from "./taskbar-progress"
import { allowRendererPermissions, wireNavigationPolicy, wireRendererHeaders } from "./security"

const revealDrivers = new WeakMap<BrowserWindow, ReturnType<typeof createRevealDriver>>()

const displays = {
  all: () => screen.getAllDisplays().map((display) => display.bounds),
  primary: () => screen.getPrimaryDisplay().bounds,
  matching: (bounds: Electron.Rectangle) => screen.getDisplayMatching(bounds).bounds,
}

const registry = createWindowRegistry<BrowserWindow>({
  read: () => getStore().get(WINDOW_IDS_KEY),
  write: (ids) => getStore().set(WINDOW_IDS_KEY, ids),
})

const opened = new Set<(win: BrowserWindow, id: string) => void>()

export {
  getBackgroundColor,
  getPinchZoomEnabled,
  registerRendererProtocol,
  setProtocolReporter,
  setBackgroundColor,
  setDockIcon,
  setPinchZoomEnabled,
  setTaskbarBadge,
  setTaskbarProgress,
  setTitlebar,
  setTrafficLightsPosition,
  setZoomLevel,
  updateTitlebar,
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

/** The persistent id of an app window, or undefined for popups and other native windows. */
export function getWindowID(win: BrowserWindow) {
  // An open window's id stays in the persisted list until it closes.
  return registry.persisted().find((id) => registry.get(id) === win)
}

/** App windows that host the renderer, excluding popups and other native windows. */
export function getMainWindows() {
  return registry.list().filter((win) => !win.isDestroyed())
}

/** Runs for each app window as it registers, before its renderer loads. */
export function onMainWindow(listener: (win: BrowserWindow, id: string) => void) {
  opened.add(listener)

  return () => {
    opened.delete(listener)
  }
}

export function setWindowThemeReady(win: BrowserWindow) {
  revealDrivers.get(win)?.dispatch({ type: "theme.ready" })
}

export const mainWindows = Effect.fn("Window.make")(function* (input: {
  readonly appState: () => State
  readonly relaunch: () => void
  /** Called when the close dialog's Quit button is chosen. */
  readonly quit: () => void
  /** Windows logoff or shutdown. */
  readonly sessionEnding: () => void
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const storage = yield* DesktopStorage.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const wireWindowRecovery = yield* windowRecovery

  const closePrompt = createClosePrompt({
    quit: input.quit,
    isQuitting: () => isQuitting(input.appState()),
  })

  // Turning a Windows contrast theme on or off changes the caption buttons' colour (`titlebarOverlay`).
  if (process.platform === "win32") {
    const contrastChanged = () => getMainWindows().forEach(updateTitlebar)
    nativeTheme.on("updated", contrastChanged)
    yield* Effect.addFinalizer(() => Effect.sync(() => nativeTheme.off("updated", contrastChanged)))
  }

  // The entry module created and showed the first restored window on ready; it is adopted here,
  // before any renderer loads, so the user never waited for the layers to see a window.
  const restore = () =>
    restoreEarlyWindow({
      ids: registry.persisted(),
      fallbackId: randomUUID(),
      openExternal: (url) => runFork(openExternalURL(url)),
    }).map((step) => create(step.id, step.kind === "adopt" ? step.entry : undefined))

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

    // The early window was secured and loaded when it was created.
    if (!early) {
      allowRendererPermissions(win)
      wireNavigationPolicy(win, (url) => runFork(openExternalURL(url)))
      wireRendererHeaders(win)
      manageWindowState(win, stateFile, state, displays)
    }

    const focusForTests = () => {
      if (app.isPackaged || process.env.OPENCODE_TEST_ONBOARDING !== "1") return

      if (process.platform === "darwin") app.focus({ steal: true })
      win.focus()
    }

    const reveal = createRevealDriver({
      early: !!early,
      show: (reason) => {
        if (win.isDestroyed()) return
        win.show()
        focusForTests()
        runFork(Effect.logInfo("main window visible", reason === "ready" ? { window: id } : { window: id, reason }))
      },
    })

    revealDrivers.set(win, reveal)

    wireWindowRecovery(win, id, {
      relaunch: input.relaunch,
      reveal: () => reveal.dispatch({ type: "recovery.requested" }),
    })
    register(win, id)
    wireFullscreen(win)
    wireFocus(win)

    if (!early) loadWindow(win, "index.html")
    wireZoom(win)

    if (early) {
      focusForTests()
      runFork(Effect.logInfo("main window visible", { window: id, shownAt: early.shownAt }))
    }

    const contentReady = () => reveal.dispatch({ type: "content.ready" })

    win.once("ready-to-show", contentReady)

    if (process.platform === "linux") win.webContents.once("did-finish-load", contentReady)

    // A window moved to a display with another scale draws its badge again at that scale.
    if (process.platform === "win32") win.on("moved", () => refreshTaskbarBadge(win))
    win.once("closed", () => {
      reveal.dispatch({ type: "window.closed" })
      revealDrivers.delete(win)
    })

    return win
  }

  const register = (win: BrowserWindow, id: string) => {
    registry.register(id, win)
    win.on("focus", () => registry.focused(id))

    // The first window is created and shown focused before it is registered, so its focus event has already passed.
    if (win.isFocused()) registry.focused(id)

    // While the tray keeps the app reachable, closing the last window asks whether to hide or quit. A real quit, a
    // window that is not the last, and a build without a tray icon still close normally.
    win.on("close", (event) => {
      const decide = needsTrayCloseDecision({
        tray: keepsAppInTray(),
        quitting: isQuitting(input.appState()),
        openWindows: getMainWindows().filter((other) => other !== win).length,
      })

      if (!decide) return
      event.preventDefault()
      closePrompt.request(win)
    })

    // Windows emits session-end, but not before-quit, during shutdown and logoff.
    win.on("session-end", input.sessionEnding)
    win.on("closed", () => {
      if (!registry.closed(id, isQuitting(input.appState()))) return
      runFork(
        Effect.gen(function* () {
          yield* Effect.try(() => storage.state.clear(windowDataFile(id)))
          yield* fs.remove(path.join(app.getPath("userData"), windowStateFile(id)), { force: true })
        }).pipe(
          Effect.catch((error) => scoped("window", Effect.logError("failed to clean window state", { id, error }))),
        ),
      )
    })
    opened.forEach((listener) => listener(win, id))
  }

  return { create, restore }
})
