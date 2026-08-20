import { app, BrowserWindow } from "electron"
import type { Event } from "electron"
import { Ipc, sendIpcEvent } from "../../shared/ipc-contract"
import { writeLog, type DesktopLogger } from "../native/logging"
import { safeWebContentsURL } from "../windows/state"
import { getLastFocusedWindow, restoreMainWindows, setAppQuitting, setRelaunchHandler } from "../windows"

export function createApplicationLifecycle(logger: DesktopLogger) {
  const pendingDeepLinks: string[] = []
  const wsl = { stop: async () => {} }
  const emitDeepLinks = (urls: string[]) => {
    if (!urls.length) return
    pendingDeepLinks.push(...urls)
    const win = getLastFocusedWindow()
    if (win) sendIpcEvent(win.webContents, Ipc.app.deepLink, urls)
  }
  const relaunch = () => {
    setAppQuitting()
    void wsl.stop().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (!win) return
    win.show()
    win.focus()
  })
  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })
  app.on("before-quit", () => {
    setAppQuitting()
    void wsl.stop()
  })
  app.on("will-quit", () => {
    setAppQuitting()
    void wsl.stop()
  })
  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })
  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })
  setRelaunchHandler(relaunch)
  ;(["SIGINT", "SIGTERM"] as const).forEach((signal) => {
    process.on(signal, () => {
      setAppQuitting()
      void wsl.stop().finally(() => app.quit())
    })
  })

  return {
    relaunch,
    prepareToRestart: () => wsl.stop(),
    setWslShutdown(stop: () => Promise<void>) {
      wsl.stop = stop
    },
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    restoreWindows() {
      app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit()
      })
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) restoreMainWindows()
      })
      return restoreMainWindows()
    },
  }
}
