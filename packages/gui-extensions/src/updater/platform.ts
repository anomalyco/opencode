import { app, autoUpdater, shell } from "electron"
import pkg from "electron-updater"
import { Effect } from "effect"
import type { Platform } from "./machine"
import { requiresStableMacInstaller, stableMacDownload } from "./migration"

const updateClient = pkg.autoUpdater

const restartTimeout = 10_000

const stableArtifact = "https://opencode.ai/update/api/latest/desktop/opencode"

export const make = Effect.fn("Updater.platform")(function* (channel: string) {
  const external = requiresStableMacInstaller(process.platform, channel)
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
        if (external) {
          const response = await fetch(stableArtifact, { headers: { "User-Agent": userAgent } })

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
    externalInstall: external ? openExternal : undefined,
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
)

// Only web links leave the app; a failure to open one is not an install error.
function openExternal(url: string) {
  if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol))
    return Effect.logWarning("blocked external target", { url })

  return Effect.tryPromise(() => shell.openExternal(url)).pipe(
    Effect.catch((error) => Effect.logError("failed to open external target", { url, error })),
  )
}
