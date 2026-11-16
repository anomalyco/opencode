import electron, { app, dialog } from "electron"
import pkg, { type AppUpdater, type CancellationToken } from "electron-updater"
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
  // Both updaters take their cache folder name from app-update.yml, and both feeds name their installers alike. In one
  // folder each updater would overwrite, delete and install the other's download. electron-updater 6.8.9 has no option
  // for the folder: AppUpdater.getOrCreateDownloadHelper reads it from this internal field, so the OpenCode 2 updater
  // reads the same config under its own folder name. Without the field there is no safe folder and no OpenCode 2 offer.
  // Check this again whenever electron-updater changes.
  const config: { value: Promise<{ updaterCacheDirName?: string }> } | undefined = Reflect.get(
    autoUpdater,
    "configOnDisk",
  )
  if (!config) throw new Error("electron-updater cannot give the OpenCode 2 download its own folder")
  // autoUpdater is already the right updater for this platform and package type, so build another of the same class.
  const Updater = autoUpdater.constructor as new (options: { provider: "generic"; url: string }) => AppUpdater
  const updater = new Updater({ provider: "generic", url: MAJOR_FEED })
  Reflect.set(updater, "configOnDisk", {
    get value() {
      return config.value.then((disk) => ({
        ...disk,
        updaterCacheDirName: `${disk.updaterCacheDirName ?? app.getName()}-major`,
      }))
    },
  })
  updater.logger = getLogger()
  updater.channel = "latest"
  // Setting the channel allows downgrades. This feed must only ever move the app forward.
  updater.allowDowngrade = false
  updater.allowPrerelease = false
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  // The OpenCode 2 feed has no block maps against an OpenCode 1 install, so a differential download could only fail
  // before the full one starts. On macOS it would also keep a second copy of the archive.
  updater.disableDifferentialDownload = true
  return updater
}

// On macOS only Squirrel can install, and it first fetches, unpacks and verifies the archive. electron-updater resolves
// as soon as it has handed the archive over, so this waits for Squirrel itself to report the staged update, or the
// error that stopped it. A staged update installs at the next quit and cannot be handed back.
function squirrel(updater: AppUpdater) {
  const staged = Promise.withResolvers<void>()
  const done = () => staged.resolve()
  const refused = () => staged.reject(new Error("Squirrel found no update to stage"))
  electron.autoUpdater.once("update-downloaded", done)
  electron.autoUpdater.once("update-not-available", refused)
  electron.autoUpdater.once("error", staged.reject)
  return Promise.all([updater.downloadUpdate(), staged.promise]).finally(() => {
    electron.autoUpdater.off("update-downloaded", done)
    electron.autoUpdater.off("update-not-available", refused)
    electron.autoUpdater.off("error", staged.reject)
  })
}

function quitAndInstall(updater: AppUpdater) {
  // quitAndInstall closes all windows before emitting before-quit, so
  // flag the quit first to keep window ids persisted for restore.
  setAppQuitting()
  // electron-updater reports an installer that could not start as an error event and then returns normally.
  const failures: unknown[] = []
  const fail = (error: Error) => {
    failures.push(error)
  }
  updater.on("error", fail)
  try {
    updater.quitAndInstall()
  } catch (error) {
    failures.push(error)
  } finally {
    updater.off("error", fail)
  }
  if (failures.length === 0) return
  // The install failed and the app keeps running; clear the flag so
  // deliberate window closes prune ids again.
  setAppQuitting(false)
  throw failures[0]
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

  const backend: UpdaterBackend = {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: () => quitAndInstall(autoUpdater),
  }

  const majorBackend = (): MajorUpdaterBackend => {
    // Built on the first OpenCode 2 check. While an OpenCode 1 release is the update to install, this updater does not
    // exist, so on macOS it cannot listen to the system updater that the OpenCode 1 release goes through.
    const lazy: { updater?: AppUpdater; download?: CancellationToken } = {}
    const updater = () => (lazy.updater ??= majorUpdater())
    // electron-updater only arms its install on quit while a download finishes. The installer is already in the cache,
    // so downloading again returns at once and arms it.
    const arm = () => {
      updater().autoInstallOnAppQuit = true
      return (process.platform === "darwin" ? squirrel(updater()) : updater().downloadUpdate()).catch((error) => {
        updater().autoInstallOnAppQuit = false
        throw error
      })
    }
    return {
      checkForUpdates: async () => updater().checkForUpdates(),
      downloadUpdate: () => {
        lazy.download = new pkg.CancellationToken()
        return updater().downloadUpdate(lazy.download)
      },
      cancelDownload: () => lazy.download?.cancel(),
      stage: async () => {
        if (process.platform !== "darwin") return false
        await arm()
        return true
      },
      // A .deb, .rpm or pacman package installs behind a password prompt, which must not appear after the windows have
      // closed. Only a restart is offered there.
      installOnQuit: process.platform !== "linux" || autoUpdater instanceof pkg.AppImageUpdater ? arm : undefined,
      disarm: () => {
        if (lazy.updater) lazy.updater.autoInstallOnAppQuit = false
      },
      quitAndInstall: () => quitAndInstall(updater()),
    }
  }

  const store = getStore("opencode.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend,
    // Only the release channel ships OpenCode 1 desktop builds.
    major: UPDATER_ENABLED && CHANNEL === "prod" ? majorBackend() : undefined,
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
  const state = await controller.checkNow()
  // With no OpenCode 1 release left to install, checking for updates opens the OpenCode 2 offer instead.
  const major = controller.major.getState().status
  if (alertOnFail && state.status !== "ready" && major !== "unavailable" && major !== "downloading") return offerMajor()
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
