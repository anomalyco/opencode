import { app, dialog } from "electron"
import pkg, { type AppUpdater } from "electron-updater"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import {
  createUpdaterController,
  type MajorUpdaterBackend,
  type UpdaterBackend,
  type UpdaterReadyRecord,
} from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"

const { autoUpdater } = pkg
const key = "ready"

// OpenCode 2 desktop keeps the app ID, so its installer replaces OpenCode 1 in place.
// OpenCode 1 reads GitHub releases; this is the feed OpenCode 2 publishes to.
const MAJOR_FEED = "https://opencode.ai/update/api/latest/desktop/opencode/"

// A second updater, so switching feeds can never make the OpenCode 1 updater download OpenCode 2.
function majorUpdater() {
  // autoUpdater is already the right updater for this platform and package type, so build another of the same class.
  const Updater = autoUpdater.constructor as new (options: { provider: "generic"; url: string }) => AppUpdater
  const updater = new Updater({ provider: "generic", url: MAJOR_FEED })
  updater.logger = getLogger()
  updater.channel = "latest"
  updater.allowPrerelease = false
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  return updater
}

export function setupAutoUpdater(stop: () => Promise<void>) {
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

  const backend = (updater: AppUpdater): UpdaterBackend => ({
    checkForUpdates: () => updater.checkForUpdates(),
    downloadUpdate: () => updater.downloadUpdate(),
    quitAndInstall: () => {
      // quitAndInstall closes all windows before emitting before-quit, so
      // flag the quit first to keep window ids persisted for restore.
      setAppQuitting()
      try {
        updater.quitAndInstall()
      } catch (error) {
        // The install failed and the app keeps running; clear the flag so
        // deliberate window closes prune ids again.
        setAppQuitting(false)
        throw error
      }
    },
  })

  const majorBackend = (updater: AppUpdater): MajorUpdaterBackend => ({
    ...backend(updater),
    // electron-updater only arms its install on quit while a download finishes. The installer is already in the cache,
    // so downloading again returns at once and arms it.
    installOnQuit: () => {
      updater.autoInstallOnAppQuit = true
      return updater.downloadUpdate()
    },
  })

  const store = getStore("opencode.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: backend(autoUpdater),
    // Only the release channel ships OpenCode 1 desktop builds.
    major: UPDATER_ENABLED && CHANNEL === "prod" ? majorBackend(majorUpdater()) : undefined,
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(
  controller: ReturnType<typeof setupAutoUpdater>,
  alertOnFail: boolean,
  offerMajor: () => void,
) {
  const state = await controller.check()
  // With no OpenCode 1 release left to install, checking for updates opens the OpenCode 2 offer instead.
  const major = controller.major.getState().status
  if (alertOnFail && state.status !== "ready" && (major === "ready" || major === "scheduled")) return offerMajor()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
