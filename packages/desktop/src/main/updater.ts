import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { getLogger } from "./logging"

const { autoUpdater } = pkg
type UpdateCheckResult = { updateAvailable: boolean; version?: string; failed?: boolean }
let downloadedVersion: string | undefined
let pendingCheck: Promise<UpdateCheckResult> | undefined

export function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (downloadedVersion) return { updateAvailable: true, version: downloadedVersion }
  if (pendingCheck) return pendingCheck

  pendingCheck = checkAndDownloadUpdate().finally(() => {
    pendingCheck = undefined
  })
  return pendingCheck
}

async function checkAndDownloadUpdate(): Promise<UpdateCheckResult> {
  const logger = getLogger()
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("update metadata fetched", {
      releaseVersion: updateInfo?.version ?? null,
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      files: updateInfo?.files?.map((file) => file.url) ?? [],
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    logger.log("update available", { version })
    await autoUpdater.downloadUpdate()
    downloadedVersion = version
    logger.log("update download completed", { version })
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

export async function installUpdate(killSidecar: () => Promise<void>) {
  const result = downloadedVersion ? { updateAvailable: true, version: downloadedVersion } : await checkUpdate()
  const logger = getLogger()
  if (!result.updateAvailable || !downloadedVersion) {
    logger.log("install update skipped", {
      reason: result.failed ? "update check failed" : "no update available",
    })
    return
  }
  logger.log("installing downloaded update", {
    version: result.version ?? null,
  })
  await killSidecar()
  autoUpdater.quitAndInstall()
}

export async function checkForUpdates(alertOnFail: boolean, killSidecar: () => Promise<void>) {
  if (!UPDATER_ENABLED) return
  const logger = getLogger()
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    restartNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate(killSidecar)
  }
}
