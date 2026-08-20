import { app, autoUpdater } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import { setAppQuitting } from "../windows"
import type { Platform } from "./index"

const updateClient = pkg.autoUpdater
const restartTimeout = 10_000

export const make = Effect.gen(function* () {
  const context = yield* Effect.context()
  const runFork = Effect.runForkWith(context)
  updateClient.logger = {
    info: (...args) => runFork(Effect.logInfo(...args)),
    warn: (...args) => runFork(Effect.logWarning(...args)),
    error: (...args) => runFork(Effect.logError(...args)),
    debug: (...args) => runFork(Effect.logDebug(...args)),
  }
  updateClient.channel = "latest"
  updateClient.allowPrerelease = false
  updateClient.allowDowngrade = true
  updateClient.autoDownload = false
  updateClient.autoInstallOnAppQuit = process.platform === "darwin"
  yield* Effect.logInfo("auto updater configured", {
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    currentVersion: app.getVersion(),
  })
  const beforeQuit = () => setAppQuitting()
  autoUpdater.on("before-quit-for-update", beforeQuit)

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        const result = await updateClient.checkForUpdates()
        return result?.isUpdateAvailable ? result.updateInfo.version : undefined
      },
      catch: (error) => error,
    }),
    stageUpdate: Effect.tryPromise({
      try: async () => {
        await stageUpdate()
      },
      catch: (error) => error,
    }),
    installAndRestart: Effect.tryPromise({
      try: installAndRestart,
      catch: (error) => error,
    }),
    dispose: () => autoUpdater.off("before-quit-for-update", beforeQuit),
  } satisfies Platform
})

function stageUpdate() {
  if (process.platform !== "darwin") return updateClient.downloadUpdate()

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      autoUpdater.removeListener("update-downloaded", complete)
      updateClient.removeListener("error", fail)
    }
    const complete = () => {
      cleanup()
      resolve()
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }

    autoUpdater.once("update-downloaded", complete)
    updateClient.once("error", fail)
    void updateClient.downloadUpdate().catch(fail)
  })
}

function installAndRestart() {
  return new Promise<never>((_resolve, reject) => {
    const timeout = setTimeout(() => {
      Effect.runFork(Effect.logError("update restart did not start"))
      fail(new Error())
    }, restartTimeout)
    const started = () => {
      clearTimeout(timeout)
      autoUpdater.removeListener("before-quit-for-update", started)
    }
    const fail = (error: Error) => {
      clearTimeout(timeout)
      autoUpdater.removeListener("before-quit-for-update", started)
      updateClient.removeListener("error", fail)
      setAppQuitting(false)
      reject(error)
    }

    autoUpdater.once("before-quit-for-update", started)
    updateClient.once("error", fail)
    try {
      updateClient.quitAndInstall()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
