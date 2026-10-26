import { app, autoUpdater } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import type { Platform } from "./machine"

const updateClient = pkg.autoUpdater

const restartTimeout = 10_000

export const make = Effect.fn("Updater.platform")(function* (channel: string) {
  const userAgent = `opencode/${channel === "prod" ? "latest" : channel}/${app.getVersion()}/desktop`
  const runFork = Effect.runForkWith(yield* Effect.context())
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
  updateClient.autoInstallOnAppQuit = process.platform === "darwin"
  yield* Effect.logInfo("auto updater configured", {
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    currentVersion: app.getVersion(),
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
  } satisfies Platform
})

function stageUpdate(options: { readonly differential: boolean }) {
  if (process.platform !== "darwin")
    return Effect.tryPromise({
      try: () => {
        // Only the NSIS cache goes stale: macOS refreshes its cached zip with every download and AppImage reads the
        // blockmap embedded in the running file. An emulated x64 install updates to the ARM64 installer, which cannot
        // be patched from the cached x64 one.
        updateClient.disableDifferentialDownload =
          process.platform === "win32" && (!options.differential || app.runningUnderARM64Translation)

        return updateClient.downloadUpdate()
      },
      catch: (error) => error,
    }).pipe(Effect.asVoid)

  return Effect.callback<void, Error>((resume) => {
    const cleanup = () => {
      autoUpdater.removeListener("update-downloaded", complete)
      updateClient.removeListener("error", fail)
    }

    const complete = () => {
      cleanup()
      resume(Effect.void)
    }

    const fail = (error: Error) => {
      cleanup()
      resume(Effect.fail(error))
    }

    autoUpdater.once("update-downloaded", complete)
    updateClient.once("error", fail)
    void updateClient.downloadUpdate().catch(fail)

    return Effect.sync(cleanup)
  })
}

const installAndRestart = Effect.callback<void, Error>((resume) => {
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

  try {
    updateClient.quitAndInstall()
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }

  return Effect.sync(cleanup)
}).pipe(
  Effect.timeoutOrElse({
    duration: restartTimeout,
    orElse: () =>
      Effect.logError("update restart did not start").pipe(
        Effect.andThen(Effect.fail(new Error("Update restart did not start"))),
      ),
  }),
)
