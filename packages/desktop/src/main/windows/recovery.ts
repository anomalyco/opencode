import { app, dialog } from "electron"
import type { BrowserWindow } from "electron"
import { Effect } from "effect"
import type { DesktopNativeKey } from "@opencode/app/i18n/desktop-native"
import { DesktopLogging, scoped } from "../native/logging"
import { nativeT } from "../native/translations"
import {
  createRecoveryDriver,
  formatUnresponsiveSamples,
  type RecoveryAction,
  type RecoveryErrorKind,
  type RecoveryIncident,
} from "./recovery-machine"
import { safeWindowURL } from "./state"

const ACTION_LABELS = {
  relaunch: "desktop.recovery.action.relaunch",
  "export-logs": "desktop.recovery.action.exportLogs",
  "keep-waiting": "desktop.recovery.action.keepWaiting",
  quit: "desktop.recovery.action.quit",
} satisfies Record<RecoveryAction, DesktopNativeKey>

const ERROR_MESSAGES = {
  dialog: "failed to show recovery dialog",
  export: "failed to export debug logs",
  "export-timeout": "debug log export timed out",
  sample: "failed to collect unresponsive sample",
  command: "recovery command failed",
} satisfies Record<RecoveryErrorKind, string>

export const windowRecovery = Effect.gen(function* () {
  const context = yield* Effect.context()
  const runFork = Effect.runForkWith(context)
  const runPromise = Effect.runPromiseWith(context)
  const logging = yield* DesktopLogging.Service

  function wireWindowRecovery(
    win: BrowserWindow,
    name: string,
    options: {
      readonly relaunch: () => void
      /** Shows a window that is still hidden; the dialog is modal to it. */
      readonly reveal: () => void
    },
  ) {
    const isDevToolsOpen = () => !win.isDestroyed() && win.webContents.isDevToolsOpened()

    const recovery = createRecoveryDriver({
      reveal: options.reveal,
      showDialog: (view, signal) => {
        const text = dialogText(view.incident, name)

        return dialog
          .showMessageBox(win, {
            type: "warning",
            buttons: view.actions.map((action) => nativeT(ACTION_LABELS[action])),
            defaultId: view.defaultId,
            cancelId: view.cancelId,
            message: text.message,
            detail: text.detail,
            signal,
          })
          .then((result) => result.response)
      },
      exportLogs: () => runPromise(Effect.asVoid(logging.exportDebug)),
      collectSample: async () => {
        if (win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.mainFrame.isDestroyed()) return

        return (await win.webContents.mainFrame.collectJavaScriptCallStack()) || undefined
      },
      flushSamples: (samples) =>
        runFork(scoped("window", Effect.logError(formatUnresponsiveSamples(name, safeWindowURL(win), samples)))),
      logError: (failure) =>
        runFork(
          scoped("window", Effect.logError(ERROR_MESSAGES[failure.kind], { window: name, error: failure.error })),
        ),
      isDevToolsOpen,
      isDestroyed: () => win.isDestroyed(),
      relaunch: options.relaunch,
      quit: () => app.quit(),
    })

    const failed = (
      event: string,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      runFork(
        scoped(
          "window",
          Effect.logError("renderer load failed", {
            window: name,
            event,
            errorCode,
            errorDescription,
            validatedURL,
            currentURL: safeWindowURL(win),
            isMainFrame,
          }),
        ),
      )
      recovery.dispatch({
        type: "load.failed",
        url: validatedURL,
        code: errorCode,
        description: errorDescription,
        isMainFrame,
      })
    }

    win.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => {
      failed("did-fail-load", code, description, url, mainFrame)
    })
    win.webContents.on("did-fail-provisional-load", (_event, code, description, url, mainFrame) => {
      failed("did-fail-provisional-load", code, description, url, mainFrame)
    })
    win.webContents.on("render-process-gone", (_event, details) => {
      runFork(
        scoped(
          "window",
          Effect.logError("renderer process gone", { window: name, currentURL: safeWindowURL(win), details }),
        ),
      )
      recovery.dispatch({ type: "process.gone", reason: details.reason, exitCode: details.exitCode })
    })
    win.on("unresponsive", () => {
      runFork(
        scoped("window", Effect.logError("renderer unresponsive", { window: name, currentURL: safeWindowURL(win) })),
      )
      recovery.dispatch({ type: "renderer.unresponsive", devtoolsOpen: isDevToolsOpen() })
    })
    win.on("responsive", () => {
      runFork(
        scoped("window", Effect.logError("renderer responsive", { window: name, currentURL: safeWindowURL(win) })),
      )
      recovery.dispatch({ type: "renderer.responsive" })
    })
    win.once("closed", () => recovery.dispatch({ type: "window.closed" }))
    win.webContents.on("console-message", (event) => {
      if (event.message.toLowerCase().includes("terminal") || event.sourceId.toLowerCase().includes("terminal")) {
        runFork(
          scoped(
            "pty",
            Effect.logInfo("console", {
              window: name,
              level: event.level,
              message: event.message,
              line: event.lineNumber,
              sourceId: event.sourceId,
            }),
          ),
        )
      }
    })
    win.webContents.on("preload-error", (_event, path, error) => {
      runFork(scoped("preload", Effect.logError("preload error", { window: name, preloadPath: path, error })))
    })
  }

  return wireWindowRecovery
})

function dialogText(incident: RecoveryIncident, window: string) {
  if (incident.kind === "unresponsive")
    return {
      message: nativeT("desktop.recovery.unresponsive"),
      detail: nativeT("desktop.recovery.unresponsive.detail"),
    }

  if (incident.kind === "load-failed")
    return {
      message: nativeT("desktop.recovery.loadFailed"),
      detail: nativeT("desktop.recovery.loadFailed.detail", {
        window,
        url: incident.url,
        code: incident.code,
        description: incident.description,
      }),
    }

  return {
    message: nativeT("desktop.recovery.terminated"),
    detail: nativeT("desktop.recovery.terminated.detail", {
      window,
      reason: incident.reason,
      code: incident.exitCode ?? nativeT("desktop.recovery.unknown"),
    }),
  }
}
