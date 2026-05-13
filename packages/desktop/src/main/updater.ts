import { app, dialog } from "electron"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { initLogging } from "./logging"

const logger = initLogging()
const { autoUpdater } = pkg

let downloadedUpdateVersion: string | undefined

/**
 * Read the "autoupdate" setting from the global opencode config file.
 * The desktop app does not share the CLI's Effect-based config service,
 * so we read the file directly using the same path resolution logic.
 *
 * Checks (in order of priority):
 * 1. OPENCODE_DISABLE_AUTOUPDATE env var
 * 2. Managed/system config dir (enterprise, not user-overridable)
 * 3. User global config (~/.config/opencode/opencode.json[c])
 */
function isAutoupdateDisabled(): boolean {
  // Environment variable takes highest runtime priority
  if (process.env.OPENCODE_DISABLE_AUTOUPDATE === "true") {
    logger.log("autoupdate disabled by OPENCODE_DISABLE_AUTOUPDATE env var")
    return true
  }

  // Resolve config: check managed dir first (enterprise/MDM), then user global
  const configDirs: string[] = []

  // Managed config dir (highest config priority, same logic as CLI's ConfigManaged.managedConfigDir)
  const managedDir = (() => {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/opencode"
      case "win32":
        return join(process.env.ProgramData || "C:\\ProgramData", "opencode")
      default:
        return "/etc/opencode"
    }
  })()
  configDirs.push(managedDir)

  // User global config dir (XDG convention, same as CLI's Global.Path.config)
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  configDirs.push(join(xdgConfigHome, "opencode"))

  for (const dir of configDirs) {
    for (const filename of ["opencode.jsonc", "opencode.json"]) {
      const filepath = join(dir, filename)
      if (!existsSync(filepath)) continue
      try {
        const text = readFileSync(filepath, "utf-8")
        // Strip JSONC comments (single-line // and multi-line /* */) before parsing
        const stripped = text
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
        const config = JSON.parse(stripped)
        if (config.autoupdate === false) {
          logger.log("autoupdate disabled by config", { path: filepath })
          return true
        }
      } catch {
        // Ignore parse errors — fall through to next file
      }
    }
  }

  return false
}

export function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  if (isAutoupdateDisabled()) return
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

export async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (isAutoupdateDisabled()) return { updateAvailable: false }
  if (downloadedUpdateVersion) {
    logger.log("returning cached downloaded update", {
      version: downloadedUpdateVersion,
    })
    return { updateAvailable: true, version: downloadedUpdateVersion }
  }
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
    logger.log("update download completed", { version })
    downloadedUpdateVersion = version
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

export async function installUpdate(killSidecar: () => Promise<void>) {
  if (!downloadedUpdateVersion) {
    logger.log("install update skipped", {
      reason: "no downloaded update ready",
    })
    return
  }
  logger.log("installing downloaded update", {
    version: downloadedUpdateVersion,
  })
  await killSidecar()
  autoUpdater.quitAndInstall()
}

export async function checkForUpdates(alertOnFail: boolean, killSidecar: () => Promise<void>) {
  if (!UPDATER_ENABLED) return
  if (isAutoupdateDisabled()) {
    logger.log("checkForUpdates skipped", { reason: "autoupdate disabled by config" })
    return
  }
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
