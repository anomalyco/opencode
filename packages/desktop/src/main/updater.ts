import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { getLogger } from "./logging"
import { createUpdaterController, type UpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getStore } from "./store"

const { autoUpdater } = pkg
const PERSISTENCE_KEY = "ready"

let controller: UpdaterController | undefined

export function setupAutoUpdater(stop: () => Promise<void>): UpdaterController {
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

  const store = getStore("opencode.updater")
  controller = createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: autoUpdater,
    persistence: {
      get() {
        const value = store.get(PERSISTENCE_KEY)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(PERSISTENCE_KEY, value),
      clear: () => store.delete(PERSISTENCE_KEY),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
  return controller
}

export function getUpdaterController(): UpdaterController | undefined {
  return controller
}

type UpdateCheckResult = { updateAvailable: boolean; version?: string; failed?: boolean }

/**
 * Legacy checkUpdate — delegates to controller.check() and maps the stateful
 * result back to the original { updateAvailable, version, failed } shape.
 */
export async function checkUpdate(): Promise<UpdateCheckResult> {
  if (!controller) return { updateAvailable: false }
  const state = await controller.check()
  if (state.status === "ready") return { updateAvailable: true, version: state.version }
  if (state.status === "error") return { updateAvailable: false, failed: true }
  return { updateAvailable: false }
}

/**
 * Legacy installUpdate — delegates to controller.install().
 * The killSidecar parameter is ignored because the controller already has
 * the stop function wired in at creation time.
 */
export async function installUpdate(_killSidecar: () => Promise<void>) {
  if (!controller) return
  const logger = getLogger()
  try {
    await controller.install()
  } catch (error) {
    logger.error("install update failed", error)
  }
}

/**
 * Legacy checkForUpdates — delegates to showUpdaterDialog.
 */
export async function checkForUpdates(alertOnFail: boolean, _killSidecar: () => Promise<void>) {
  if (!controller) return
  await showUpdaterDialog(controller, alertOnFail)
}

export async function showUpdaterDialog(ctrl: UpdaterController, alertOnFail: boolean) {
  const state = await ctrl.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "error", message: "Update check failed.", title: "Update Error" })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "info", message: "You're up to date.", title: "No Updates" })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${state.version} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await ctrl.install()
}
