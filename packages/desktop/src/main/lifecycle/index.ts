export * as ApplicationLifecycle from "./index"

import { app, BrowserWindow } from "electron"
import type { Event, WebContents } from "electron"
import { Context, Effect, Layer } from "effect"
import { DeepLinksOpened } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { DesktopLogging, scoped } from "../native/logging"
import { windowDataFile } from "../../shared/ipc-transport"
import { DesktopStorage } from "../storage"
import { safeWebContentsURL } from "../windows/state"
import {
  getLastFocusedWindow,
  getMainWindows,
  getWindowByID,
  getWindowID,
  mainWindows,
  onMainWindow,
  setAppQuitting,
  setRelaunchHandler,
} from "../windows"
import { marks } from "./marks"
import { initializeFirstLaunchOnboarding } from "./onboarding"
import { Shutdown } from "./shutdown"
import { formatDeepLink, linkBatchWindow, parseDeepLink, pickLinkWindow, tabsHoldSession } from "./deep-link"
import { linkArguments, receiveLinks } from "./link-intake"
import { createLinkQueue } from "./link-queue"

export interface Interface {
  readonly relaunch: () => void
  readonly prepareToRestart: Effect.Effect<void>
  readonly consumeInitialDeepLinks: (contents: WebContents) => string[]
  readonly createWindow: () => BrowserWindow
  readonly restoreWindows: () => BrowserWindow[]
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/ApplicationLifecycle") {}

const runtime = Layer.effect(
  Service,
  Effect.gen(function* () {
    const shutdown = yield* Shutdown.Service
    const runFork = Effect.runForkWith(yield* Effect.context())
    const windows = yield* mainWindows()
    const createWindow = windows.create
    const restoreWindows = windows.restore
    const storage = yield* DesktopStorage.Service
    const links = createLinkQueue<number>()
    let shutdownReady = false
    let quitRequested = false

    // A hung shutdown step would otherwise leave every quit waiting on it forever.
    const prepareToRestart = shutdown.run.pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.logError("shutdown timed out, quitting anyway"),
      }),
      Effect.ensuring(Effect.sync(() => (shutdownReady = true))),
    )

    const focusWindow = (win: BrowserWindow | null) => {
      if (!win) return

      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }

    // Restored windows exist before `activate` runs, so it finds windows and doesn't restore them again.
    const linkWindow = (sessionID?: string) =>
      pickLinkWindow({
        open: getMainWindows(),
        restore: restoreWindows,
        create: createWindow,
        focused: getLastFocusedWindow(),
        holds: sessionID
          ? (win) => {
              const id = getWindowID(win)

              return !!id && tabsHoldSession(storage.state.get(windowDataFile(id), "tabs"), sessionID)
            }
          : undefined,
      })

    const openLink = (url: string) => {
      const link = parseDeepLink(url)

      if (!link) {
        runFork(Effect.logWarning("deep link rejected"))

        return
      }

      if (link.type === "console") return getWindowByID(link.windowID) ?? getLastFocusedWindow()
      const win = linkWindow(link.sessionID)
      const canonical = formatDeepLink(link)
      runFork(
        Effect.logInfo("deep link opened", { type: link.type, sessionID: link.sessionID, window: getWindowID(win) }),
      )

      if (links.push(win.webContents.id, canonical))
        emitIpcEvent(win.webContents, new DeepLinksOpened({ urls: [canonical] }))

      return win
    }

    const openLinks = (urls: string[]) => focusWindow(linkBatchWindow(urls.map(openLink), () => linkWindow()))

    const wireLinks = (win: BrowserWindow) => {
      const contents = win.webContents.id
      win.webContents.on(
        "did-start-navigation",
        (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
          if (event.isMainFrame && !event.isSameDocument) links.unload(contents)
        },
      )
      win.once("closed", () => links.close(contents))
    }

    const relaunch = () => {
      setAppQuitting()
      runFork(
        prepareToRestart.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              app.relaunch()
              app.quit()
            }),
          ),
        ),
      )
    }

    // Links in the argv are routed by the link intake.
    const secondInstance = (_event: Event, argv: string[]) => {
      if (!linkArguments(argv).length) focusWindow(getLastFocusedWindow())
    }

    const beforeQuit = (event: Event) => {
      quitRequested = true
      setAppQuitting()

      if (shutdownReady) return
      event.preventDefault()
      // Electron records the cancelled quit only after this event returns. A shutdown with nothing to
      // stop finishes in a microtask, so re-quitting from it would be overwritten and the app would
      // stay alive with no windows. Re-quit on the next tick instead.
      runFork(prepareToRestart.pipe(Effect.ensuring(Effect.sync(() => setImmediate(() => app.quit())))))
    }

    const willQuit = () => {
      setAppQuitting()
      runFork(shutdown.run)
    }

    const childProcessGone = (_event: Event, details: Electron.Details) => {
      runFork(scoped("utility", Effect.logError("child process gone", { details })))
    }

    const renderProcessGone = (
      _event: Event,
      webContents: Electron.WebContents,
      details: Electron.RenderProcessGoneDetails,
    ) => {
      runFork(
        scoped("window", Effect.logError("app render process gone", { url: safeWebContentsURL(webContents), details })),
      )
    }

    const signal = () => {
      setAppQuitting()
      runFork(prepareToRestart.pipe(Effect.ensuring(Effect.sync(() => app.quit()))))
    }

    // Electron emits this instead of will-quit when it lost track of a quit, so finish the one we asked for.
    const windowAllClosed = () => {
      if (quitRequested || process.platform !== "darwin") app.quit()
    }

    const activate = () => {
      if (quitRequested) return

      if (BrowserWindow.getAllWindows().length === 0) restoreWindows()
    }

    const resetRelaunchHandler = setRelaunchHandler(relaunch)
    const stopWindowLinks = onMainWindow(wireLinks)
    let stopLinks = () => {}

    let windowsWired = false

    app.on("second-instance", secondInstance)
    app.on("before-quit", beforeQuit)
    app.on("will-quit", willQuit)
    app.on("child-process-gone", childProcessGone)
    app.on("render-process-gone", renderProcessGone)
    process.on("SIGINT", signal)
    process.on("SIGTERM", signal)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("second-instance", secondInstance)
        app.off("before-quit", beforeQuit)
        app.off("will-quit", willQuit)
        app.off("child-process-gone", childProcessGone)
        app.off("render-process-gone", renderProcessGone)
        app.off("window-all-closed", windowAllClosed)
        app.off("activate", activate)
        process.off("SIGINT", signal)
        process.off("SIGTERM", signal)
        resetRelaunchHandler()
        stopWindowLinks()
        stopLinks()
      }),
    )

    return Service.of({
      relaunch,
      prepareToRestart,
      consumeInitialDeepLinks: (contents) => links.take(contents.id),
      createWindow,
      restoreWindows: () => {
        const restored = restoreWindows()

        if (!windowsWired) {
          windowsWired = true
          app.on("window-all-closed", windowAllClosed)
          app.on("activate", activate)
          // Links that launched the app waited for the restored windows, so one already showing
          // the session can take it instead of a new one.
          stopLinks = receiveLinks(openLinks)
        }

        return restored
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
