import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { app, autoUpdater } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import type { Platform } from "./machine"

const updateClient = pkg.autoUpdater

const execFileAsync = promisify(execFile)

const restartTimeout = 10_000

const unpackTimeout = 120_000

export type DesktopPlatform = Platform & {
  /** Updates whether a downloaded update installs automatically when the app quits. */
  readonly setInstallOnQuit: (enabled: boolean) => void
  /** macOS only: true once Squirrel.Mac has staged an update for the next quit. */
  readonly isPendingQuitInstall: () => boolean
}

export const make = Effect.fn("Updater.platform")(function* (
  channel: string,
  options: {
    readonly installOnQuit: boolean
    readonly onQuitPendingChanged?: () => void
  },
) {
  const userAgent = `opencode/${channel === "prod" ? "latest" : channel}/${app.getVersion()}/desktop`
  const runFork = Effect.runForkWith(yield* Effect.context())

  const quitState = {
    installOnQuit: options.installOnQuit,
    downloading: false,
    // macOS only: tracks whether electron-updater has a zip ready on its local Squirrel proxy and whether
    // Squirrel.Mac has already fetched it (which arms Squirrel's automatic install-on-quit).
    macDownloadId: 0,
    macDownloaded: false,
    squirrelStaged: false,
    squirrelStaging: false,
  }

  updateClient.logger = {
    info: (...args) => runFork(Effect.logInfo(...args)),
    warn: (...args) => runFork(Effect.logWarning(...args)),
    error: (...args) => runFork(Effect.logError(...args)),
    debug: (...args) => runFork(Effect.logDebug(...args)),
  }
  updateClient.channel = "latest"
  updateClient.requestHeaders = { "User-Agent": userAgent }
  updateClient.allowPrerelease = false
  updateClient.allowDowngrade = true
  updateClient.autoDownload = false
  updateClient.autoInstallOnAppQuit = options.installOnQuit
  yield* Effect.logInfo("auto updater configured", {
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    autoInstallOnAppQuit: updateClient.autoInstallOnAppQuit,
    currentVersion: app.getVersion(),
  })

  const setSquirrelStaged = (staged: boolean) => {
    if (quitState.squirrelStaged === staged) return
    quitState.squirrelStaged = staged
    options.onQuitPendingChanged?.()
  }

  const stageMacWithSquirrel = () => {
    if (
      process.platform !== "darwin" ||
      !quitState.macDownloaded ||
      quitState.squirrelStaged ||
      quitState.squirrelStaging
    )
      return

    const id = quitState.macDownloadId
    quitState.squirrelStaging = true

    const cleanup = () => {
      autoUpdater.removeListener("update-downloaded", complete)
      updateClient.removeListener("error", fail)
    }

    const complete = () => {
      cleanup()

      if (id !== quitState.macDownloadId) return
      quitState.squirrelStaging = false
      setSquirrelStaged(true)
    }

    const fail = (error: Error) => {
      cleanup()

      if (id !== quitState.macDownloadId) return
      quitState.squirrelStaging = false
      runFork(Effect.logWarning("failed to stage update for quit on macOS", { message: error.message }))
    }

    autoUpdater.once("update-downloaded", complete)
    updateClient.once("error", fail)
    autoUpdater.checkForUpdates()
  }

  const setInstallOnQuit = (enabled: boolean) => {
    quitState.installOnQuit = enabled

    if (!quitState.downloading) updateClient.autoInstallOnAppQuit = enabled
    runFork(Effect.logInfo("auto install on quit updated", { enabled }))

    if (enabled) stageMacWithSquirrel()
  }

  const stageUpdate = (stageOptions: { readonly differential: boolean }) => {
    if (process.platform !== "darwin")
      return Effect.tryPromise({
        try: async () => {
          // Only the NSIS cache goes stale: macOS refreshes its cached zip with every download and AppImage reads the
          // blockmap embedded in the running file. An emulated x64 install updates to the ARM64 installer, which cannot
          // be patched from the cached x64 one.
          updateClient.disableDifferentialDownload =
            process.platform === "win32" && (!stageOptions.differential || app.runningUnderARM64Translation)
          // BaseUpdater registers its one-time app quit listener inside downloadUpdate() only when
          // autoInstallOnAppQuit is true, and re-checks autoInstallOnAppQuit inside that listener at quit time.
          // Keeping it true across the download lets toggling the setting on later install an already-staged update.
          quitState.downloading = true
          updateClient.autoInstallOnAppQuit = true

          try {
            return await updateClient.downloadUpdate()
          } finally {
            quitState.downloading = false
            updateClient.autoInstallOnAppQuit = quitState.installOnQuit
          }
        },
        catch: (error) => error,
      }).pipe(Effect.flatMap(unpackInstaller))

    const downloadId = ++quitState.macDownloadId
    quitState.macDownloaded = false
    quitState.squirrelStaging = false
    setSquirrelStaged(false)

    if (!quitState.installOnQuit)
      return Effect.tryPromise({
        try: async () => {
          quitState.downloading = true
          updateClient.autoInstallOnAppQuit = false

          try {
            await updateClient.downloadUpdate()
          } finally {
            quitState.downloading = false
            updateClient.autoInstallOnAppQuit = quitState.installOnQuit
          }

          if (downloadId !== quitState.macDownloadId) return
          quitState.macDownloaded = true

          if (quitState.installOnQuit) stageMacWithSquirrel()
        },
        catch: (error) => error,
      })

    return Effect.callback<void, Error>((resume) => {
      const cleanup = () => {
        autoUpdater.removeListener("update-downloaded", complete)
        updateClient.removeListener("error", fail)
        quitState.downloading = false
        updateClient.autoInstallOnAppQuit = quitState.installOnQuit
      }

      const complete = () => {
        cleanup()

        if (downloadId === quitState.macDownloadId) {
          quitState.macDownloaded = true
          setSquirrelStaged(true)
        }

        resume(Effect.void)
      }

      const fail = (error: Error) => {
        cleanup()
        resume(Effect.fail(error))
      }

      quitState.downloading = true
      updateClient.autoInstallOnAppQuit = true
      autoUpdater.once("update-downloaded", complete)
      updateClient.once("error", fail)
      void updateClient.downloadUpdate().catch(fail)

      return Effect.sync(cleanup)
    })
  }

  const installAndRestart = Effect.suspend(() => {
    // When install-on-quit is off on macOS, Squirrel.Mac has not extracted and verified the update yet,
    // so quitAndInstall() runs that step before emitting before-quit-for-update.
    const timeout = process.platform === "darwin" && !quitState.squirrelStaged ? unpackTimeout : restartTimeout

    return Effect.callback<void, Error>((resume) => {
      const cleanup = () => {
        autoUpdater.removeListener("before-quit-for-update", started)
        updateClient.removeListener("error", fail)
      }

      const started = () => {
        cleanup()
        resume(Effect.void)
      }

      const fail = (error: Error) => {
        cleanup()
        resume(Effect.fail(error))
      }

      autoUpdater.once("before-quit-for-update", started)
      updateClient.once("error", fail)

      // If Squirrel has neither staged nor started staging (e.g. setting off, or an earlier stageMacWithSquirrel()
      // failed while autoInstallOnAppQuit stayed true), MacUpdater.quitAndInstall() only calls
      // nativeUpdater.checkForUpdates() when autoInstallOnAppQuit is false.
      const forceSquirrelCheck =
        process.platform === "darwin" && !quitState.squirrelStaged && !quitState.squirrelStaging

      if (forceSquirrelCheck) updateClient.autoInstallOnAppQuit = false

      try {
        updateClient.quitAndInstall()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      } finally {
        if (forceSquirrelCheck) updateClient.autoInstallOnAppQuit = quitState.installOnQuit
      }

      return Effect.sync(cleanup)
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.logError("update restart did not start").pipe(
            Effect.andThen(Effect.fail(new Error("Update restart did not start"))),
          ),
      }),
    )
  })

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        const result = await updateClient.checkForUpdates()

        if (!result?.isUpdateAvailable) return undefined
        const files = result.updateInfo.files
        // electron-updater picks the installer whose name contains process.arch, which emulation on Windows ARM64
        // reports as x64. downloadUpdate() reads this same list, so keeping only the ARM64 installer moves the install
        // to the native build. macOS needs nothing here: electron-updater already prefers arm64 under Rosetta.
        const native = files.filter((file) => file.url.includes("arm64"))

        if (process.platform === "win32" && app.runningUnderARM64Translation && native.length > 0) {
          files.splice(0, files.length, ...native)
          runFork(
            Effect.logInfo("updating emulated x64 install to native ARM64", { urls: native.map((file) => file.url) }),
          )
        }

        return { mode: "restart", version: result.updateInfo.version } as const
      },
      catch: (error) => error,
    }),
    stageUpdate,
    installAndRestart,
    setInstallOnQuit,
    isPendingQuitInstall: () => quitState.squirrelStaged,
  } satisfies DesktopPlatform
})

// The NSIS installer unpacks the update beside the install directory while the app keeps running, so the
// install after the restart moves one directory into place instead of decompressing the whole app. When this
// fails, the restart still installs the update, only slower.
function unpackInstaller(files: string[]) {
  const installer = files.find((file) => file.endsWith(".exe"))

  if (process.platform !== "win32" || !app.isPackaged || !installer) return Effect.void

  return Effect.tryPromise((signal) =>
    execFileAsync(installer, ["--stage"], { windowsHide: true, timeout: unpackTimeout, signal }),
  ).pipe(
    Effect.andThen(Effect.logInfo("update unpacked before restart", { installer })),
    Effect.catch((error) =>
      Effect.logWarning("update not unpacked before restart", {
        installer,
        message: error.cause instanceof Error ? error.cause.message : String(error.cause),
      }),
    ),
  )
}
