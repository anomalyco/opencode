export * as ApplicationLifecycle from "./index"

import { app, BrowserWindow } from "electron"
import type { Event } from "electron"
import { Context, Effect, Layer } from "effect"
import { DeepLinks } from "../deep-links"
import { jumpList, jumpTask } from "../native/jump-list"
import { deepLinkArguments, takeLaunchLinks } from "./launch-links"
import { DesktopLogging, scoped } from "../native/logging"
import { sendMenuCommand } from "../native/menu"
import { onNativeTranslations } from "../native/translations"
import { DesktopStorage } from "../storage"
import { safeWebContentsOrigin } from "../windows/state"
import { getLastFocusedWindow, mainWindows } from "../windows"
import type { Scope } from "@opencode/plugin/gui/host"
import { marks } from "./marks"
import { createBackgroundNotice } from "./background-notice"
import {
  createDriver,
  isQuitting,
  preventsQuit,
  quitsWhenAllWindowsClosed,
  restoresWindows,
  type Handoff,
  type State,
} from "./machine"
import { initializeFirstLaunchOnboarding } from "./onboarding"
import { Shutdown } from "./shutdown"

export interface Interface {
  readonly relaunch: () => void
  readonly deepLinks: DeepLinks.Interface
  /** Where the app stands between running and exiting. */
  readonly state: () => State
  /**
   * Stops every plugin but the one whose scope is `keep`, then runs the handoff, or relaunches without one. When the
   * handoff fails, the stopped plugins start again before the promise rejects.
   */
  readonly restart: (keep: Scope, handoff?: Handoff) => Promise<void>
  readonly createWindow: () => BrowserWindow
  readonly restoreWindows: () => BrowserWindow[]
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/ApplicationLifecycle") {}

const runtime = Layer.effect(
  Service,
  Effect.gen(function* () {
    const shutdown = yield* Shutdown.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    const exits = new Set<NodeJS.Immediate>()

    // A hung step would otherwise leave every quit, or the app after a failed handoff, waiting on it forever.
    const driver = createDriver({
      stop: () =>
        runPromise(
          shutdown.stop.pipe(
            Effect.timeoutOrElse({
              duration: "10 seconds",
              orElse: () => Effect.logError("shutdown timed out, continuing anyway"),
            }),
          ),
        ),
      resume: () =>
        runPromise(
          shutdown.resume.pipe(
            Effect.timeoutOrElse({
              duration: "10 seconds",
              orElse: () => Effect.logError("resume timed out, continuing anyway"),
            }),
          ),
        ),
      // Electron records a cancelled quit only after `before-quit` returns. A stop with nothing to do finishes in a
      // microtask, so quitting from it would be overwritten and the app would stay alive with no windows. Quit on the
      // next tick instead.
      exit: (mode) => {
        const exit = setImmediate(() => {
          exits.delete(exit)

          if (mode === "relaunch") app.relaunch()
          app.quit()
        })

        exits.add(exit)
      },
    })

    const relaunch = () => driver.dispatch({ type: "exit.requested", mode: "relaunch" })

    const windows = yield* mainWindows({
      appState: driver.state,
      relaunch,
      sessionEnding: () => driver.dispatch({ type: "session.ending" }),
    })

    const createWindow = windows.create
    const restoreWindows = windows.restore

    const focusWindow = (win: BrowserWindow | null) => {
      if (!win) return

      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }

    const deepLinks = yield* DeepLinks.make(focusWindow)

    // A development build's jump list would start Electron without the app, so only installed builds set one.
    if (process.platform === "win32" && app.isPackaged) {
      const setJumpList = () => {
        const result = app.setJumpList(jumpList(process.execPath))

        if (result !== "ok") runFork(Effect.logWarning("jump list not set", { result }))
      }

      setJumpList()
      const stopJumpList = onNativeTranslations(setJumpList)
      yield* Effect.addFinalizer(() => Effect.sync(stopJumpList))
    }

    const secondInstance = (_event: Event, argv: string[]) => {
      const task = process.platform === "win32" ? jumpTask(argv) : undefined

      if (task === "new-window") {
        createWindow()

        return
      }

      if (task === "new-session") {
        const win = getLastFocusedWindow() ?? createWindow()
        focusWindow(win)
        sendMenuCommand(win, "tab.new", false)

        return
      }

      const urls = deepLinkArguments(argv)

      if (urls.length) {
        runFork(Effect.logInfo("deep link received via second-instance", { urls }))
        deepLinks.receive(urls)
      }

      if (!urls.length) focusWindow(getLastFocusedWindow())
    }

    const openUrl = (event: Event, url: string) => {
      event.preventDefault()
      runFork(Effect.logInfo("deep link received via open-url", { url }))
      deepLinks.receive([url])
    }

    const notice = createBackgroundNotice({
      parent: () => getLastFocusedWindow() ?? undefined,
      quit: () => app.quit(),
      openSettings: () => {
        const win = getLastFocusedWindow() ?? restoreWindows()[0] ?? createWindow()
        focusWindow(win)
        sendMenuCommand(win, "settings.open", false)
      },
    })

    const beforeQuit = (event: Event) => {
      // Only a quit the user starts gets the notice: relaunches, update handoffs and OS signals are already stopping.
      if (!isQuitting(driver.state()) && notice.holdsQuit()) {
        event.preventDefault()

        return
      }

      if (preventsQuit(driver.state())) event.preventDefault()
      driver.dispatch({ type: "before.quit" })
    }

    const willQuit = () => driver.dispatch({ type: "will.quit" })

    const childProcessGone = (_event: Event, details: Electron.Details) => {
      runFork(scoped("utility", Effect.logError("child process gone", { details })))
    }

    const renderProcessGone = (
      _event: Event,
      webContents: Electron.WebContents,
      details: Electron.RenderProcessGoneDetails,
    ) => {
      // Every page's process reports here, a plugin's views included (the in-app browser's pages), and logs go into
      // bug reports: the origin only. A window's own line has its address (recovery.ts).
      runFork(
        scoped(
          "window",
          Effect.logError("app render process gone", { origin: safeWebContentsOrigin(webContents), details }),
        ),
      )
    }

    const signal = () => driver.dispatch({ type: "exit.requested", mode: "quit" })

    const windowAllClosed = () => {
      if (quitsWhenAllWindowsClosed(driver.state(), process.platform)) app.quit()
    }

    const activate = () => {
      if (!restoresWindows(driver.state())) return

      if (BrowserWindow.getAllWindows().length === 0) restoreWindows()
    }

    let windowsWired = false

    app.on("second-instance", secondInstance)
    app.on("open-url", openUrl)
    app.on("before-quit", beforeQuit)
    app.on("will-quit", willQuit)
    app.on("child-process-gone", childProcessGone)
    app.on("render-process-gone", renderProcessGone)
    process.on("SIGINT", signal)
    process.on("SIGTERM", signal)

    // The router waits for a window to be ready, so the links the app was started with open once one is.
    const launched = takeLaunchLinks()

    if (launched.length) {
      runFork(Effect.logInfo("deep link received at launch", { urls: launched }))
      deepLinks.receive(launched)
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("second-instance", secondInstance)
        app.off("open-url", openUrl)
        app.off("before-quit", beforeQuit)
        app.off("will-quit", willQuit)
        app.off("child-process-gone", childProcessGone)
        app.off("render-process-gone", renderProcessGone)
        app.off("window-all-closed", windowAllClosed)
        app.off("activate", activate)
        process.off("SIGINT", signal)
        process.off("SIGTERM", signal)
        exits.forEach(clearImmediate)
        exits.clear()
      }),
    )

    return Service.of({
      relaunch,
      deepLinks,
      state: driver.state,
      restart: driver.restart,
      createWindow,
      restoreWindows: () => {
        // A quit that started while the layers loaded (the user closed the first window) opens no new window.
        if (!restoresWindows(driver.state())) return []

        if (!windowsWired) {
          windowsWired = true
          app.on("window-all-closed", windowAllClosed)
          app.on("activate", activate)
        }

        return restoreWindows()
      },
    })
  }),
)

// Storage opens after the entry module has set userData and before the renderer loads, so window
// teardown can clear a window's persisted state and every renderer request finds it ready.
const platform = Layer.mergeAll(
  DesktopLogging.layer,
  Shutdown.layer,
  DesktopStorage.layer.pipe(Layer.provide(DesktopLogging.layer)),
)

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    // Decide first-launch state before the storage layer creates drafts.sqlite, which would
    // otherwise read as evidence of an earlier launch on a fresh install.
    yield* initializeFirstLaunchOnboarding(app.getPath("userData"))
    marks.onboarding = Date.now()

    return runtime.pipe(Layer.provideMerge(platform))
  }),
)
