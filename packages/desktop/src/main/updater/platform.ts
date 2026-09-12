import { app, autoUpdater } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import { CHANNEL } from "../constants"
import { openExternalURL } from "../files"
import { setAppQuitting } from "../windows"
import type { Platform } from "./index"
import { requiresStableMacInstaller, stableMacDownload } from "./migration"

const updateClient = pkg.autoUpdater
const restartTimeout = 10_000
const stableArtifact = "https://opencode.ai/update/api/latest/desktop/opencode"

export const make = Effect.gen(function* () {
  const external = requiresStableMacInstaller(process.platform, CHANNEL)
  const runFork = Effect.runForkWith(yield* Effect.context())
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
        if (external) {
          const response = await fetch(stableArtifact)
          if (!response.ok) throw new Error(`Stable OpenCode update check failed: ${response.status}`)
          const download = stableMacDownload(await response.json(), process.arch)
          if (!download) throw new Error("Stable OpenCode download is unavailable")
          return { mode: "external", ...download } as const
        }
        const result = await updateClient.checkForUpdates()
        if (!result?.isUpdateAvailable) return undefined
        return { mode: "restart", version: result.updateInfo.version } as const
      },
      catch: (error) => error,
    }),
    stageUpdate,
    installAndRestart,
    externalInstall: external ? (url) => openExternalURL(url) : undefined,
    dispose: () => autoUpdater.off("before-quit-for-update", beforeQuit),
  } satisfies Platform
})

function stageUpdate(options: { readonly differential: boolean }) {
  if (process.platform !== "darwin")
    return Effect.tryPromise({
      try: () => {
        // Only the NSIS cache goes stale: macOS refreshes its cached zip with every download and AppImage reads the
        // blockmap embedded in the running file.
        updateClient.disableDifferentialDownload = process.platform === "win32" && !options.differential
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
  Effect.tapError(() => Effect.sync(() => setAppQuitting(false))),
  Effect.andThen(Effect.never),
)
