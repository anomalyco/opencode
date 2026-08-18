import { app, dialog } from "electron"
import type { BrowserWindow } from "electron"
import { exportDebugLogs, writeLog } from "../native/logging"
import { nativeT } from "../native/translations"
import { safeWindowURL } from "./state"
import { createUnresponsiveSampler } from "./unresponsive"

export function wireWindowRecovery(win: BrowserWindow, name: string, relaunch: () => void) {
  let showing = false
  const sampler = createUnresponsiveSampler(win, name)

  type RecoveryAction = "relaunch" | "export-logs" | "keep-waiting" | "quit"
  const handle = async (action: RecoveryAction | undefined, wait: boolean) => {
    if (action === "export-logs") {
      const sampling = sampler.stopAndFlush()
      await exportDebugLogs().catch((error) => writeLog("main", "failed to export debug logs", { error }, "error"))
      if (wait && sampling) sampler.start()
      return true
    }
    if (action === "relaunch") {
      sampler.stopAndFlush()
      relaunch()
      return false
    }
    if (action === "quit") {
      sampler.stopAndFlush()
      app.quit()
    }
    return false
  }

  const show = async (message: string, detail: string, wait: boolean) => {
    if (showing || win.isDestroyed()) return
    showing = true
    try {
      while (!win.isDestroyed()) {
        const actions: { id: RecoveryAction; label: string }[] = wait
          ? [
              { id: "relaunch", label: nativeT("desktop.recovery.action.relaunch") },
              { id: "export-logs", label: nativeT("desktop.recovery.action.exportLogs") },
              { id: "keep-waiting", label: nativeT("desktop.recovery.action.keepWaiting") },
            ]
          : [
              { id: "relaunch", label: nativeT("desktop.recovery.action.relaunch") },
              { id: "export-logs", label: nativeT("desktop.recovery.action.exportLogs") },
              { id: "quit", label: nativeT("desktop.recovery.action.quit") },
            ]
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: actions.map((action) => action.label),
          defaultId: 0,
          cancelId: 2,
          message,
          detail,
        })
        if (await handle(actions[result.response]?.id, wait)) continue
        return
      }
    } finally {
      showing = false
    }
  }

  const failed = (
    event: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    writeLog(
      "window",
      "renderer load failed",
      { window: name, event, errorCode, errorDescription, validatedURL, currentURL: safeWindowURL(win), isMainFrame },
      "error",
    )
    if (!isMainFrame || errorCode === -3) return
    void show(
      nativeT("desktop.recovery.loadFailed"),
      nativeT("desktop.recovery.loadFailed.detail", {
        window: name,
        url: validatedURL,
        code: errorCode,
        description: errorDescription,
      }),
      false,
    )
  }

  win.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => {
    failed("did-fail-load", code, description, url, mainFrame)
  })
  win.webContents.on("did-fail-provisional-load", (_event, code, description, url, mainFrame) => {
    failed("did-fail-provisional-load", code, description, url, mainFrame)
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    sampler.stopAndFlush()
    writeLog("window", "renderer process gone", { window: name, currentURL: safeWindowURL(win), details }, "error")
    void show(
      nativeT("desktop.recovery.terminated"),
      nativeT("desktop.recovery.terminated.detail", {
        window: name,
        reason: details.reason,
        code: details.exitCode ?? nativeT("desktop.recovery.unknown"),
      }),
      false,
    )
  })
  win.on("unresponsive", () => {
    writeLog("window", "renderer unresponsive", { window: name, currentURL: safeWindowURL(win) }, "error")
    sampler.start()
    void show(nativeT("desktop.recovery.unresponsive"), nativeT("desktop.recovery.unresponsive.detail"), true)
  })
  win.on("responsive", () => {
    writeLog("window", "renderer responsive", { window: name, currentURL: safeWindowURL(win) }, "error")
    sampler.stopAndFlush()
  })
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.toLowerCase().includes("terminal") || sourceId.toLowerCase().includes("terminal")) {
      writeLog("pty", "console", { window: name, level, message, line, sourceId })
    }
  })
  win.webContents.on("preload-error", (_event, path, error) => {
    writeLog("preload", "preload error", { window: name, preloadPath: path, error }, "error")
  })
}
