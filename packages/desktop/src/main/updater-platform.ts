import { app, autoUpdater } from "electron"
import pkg from "electron-updater"
import { getLogger } from "./logging"
import { setAppQuitting } from "./windows"
import type { UpdaterPlatform } from "./updater-controller"

const updateClient = pkg.autoUpdater

export function createUpdaterPlatform(logger: ReturnType<typeof getLogger>): UpdaterPlatform {
  configureUpdater(logger)
  autoUpdater.on("before-quit-for-update", () => setAppQuitting())

  return {
    checkForUpdate: () => updateClient.checkForUpdates(),
    stageUpdate,
    installAndRestart,
  }
}

function configureUpdater(logger: ReturnType<typeof getLogger>) {
  updateClient.logger = logger
  updateClient.channel = "latest"
  updateClient.allowPrerelease = false
  updateClient.allowDowngrade = true
  updateClient.autoDownload = false
  updateClient.autoInstallOnAppQuit = process.platform === "darwin"
  logger.log("auto updater configured", {
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    currentVersion: app.getVersion(),
  })
}

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
    const fail = (error: Error) => {
      updateClient.removeListener("error", fail)
      setAppQuitting(false)
      reject(error)
    }

    updateClient.once("error", fail)
    try {
      updateClient.quitAndInstall()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
