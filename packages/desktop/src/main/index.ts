import { app } from "electron"
import { Deferred, Effect, Fiber } from "effect"
import type { ServerReadyData } from "../shared/ipc-contract"
import { checkAppExists, resolveAppPath } from "./files/apps"
import { registerIpcHandlers } from "./ipc"
import {
  acquireApplicationLock,
  configureApplication,
  loadProxyEnvironment,
  preferApplicationEnvironment,
  prepareDesktop,
} from "./lifecycle/environment"
import { createApplicationLifecycle } from "./lifecycle"
import { finishFirstLaunchOnboarding, isFirstLaunchOnboardingPending } from "./lifecycle/onboarding"
import { exportDebugLogs, startNetworkLogging, writeLog } from "./native/logging"
import { createMenu, sendMenuCommand } from "./native/menu"
import { setNativeTranslations } from "./native/translations"
import { startBackgroundCli } from "./service/background-service"
import { forwardInitializationFailure } from "./service/initialization"
import { getDefaultServerUrl, setDefaultServerUrl } from "./service/server-settings"
import { createUpdaterIpc, setupAutoUpdater, showUpdaterDialog, startAutoUpdater } from "./updater"
import { getLastFocusedWindow, setBackgroundColor } from "./windows"
import { startWsl } from "./wsl/start"
import { createDeferredWslIpc } from "./wsl/ipc"

const main = Effect.gen(function* () {
  const logger = configureApplication()
  if (!acquireApplicationLock()) return
  preferApplicationEnvironment(logger)
  const lifecycle = createApplicationLifecycle(logger)
  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())
  yield* prepareDesktop(logger)

  const updater = setupAutoUpdater(lifecycle.prepareToRestart)
  const updaterIpc = createUpdaterIpc(updater)
  const wslIpc = createDeferredWslIpc()
  const menu = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater),
    relaunch: lifecycle.relaunch,
  }
  const ipcDeps: Parameters<typeof registerIpcHandlers>[0] = {
    relaunch: lifecycle.relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const result = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: result.url })
        return result
      },
      (effect) => Effect.runPromise(effect),
    ),
    consumeInitialDeepLinks: lifecycle.consumeInitialDeepLinks,
    getDefaultServerUrl,
    setDefaultServerUrl,
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    checkAppExists,
    resolveAppPath: async (appName) => resolveAppPath(appName),
    showUpdater: () => showUpdaterDialog(updater),
    setBackgroundColor,
    exportDebugLogs,
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menu)
    },
  }
  yield* Effect.promise(() => registerIpcHandlers(ipcDeps, updaterIpc, wslIpc.ipc))
  startAutoUpdater(updater)
  yield* Effect.promise(() => startNetworkLogging())

  const loadingTask = yield* Effect.gen(function* () {
    loadProxyEnvironment(logger)
    logger.log("starting v2 background service")
    const background = yield* Effect.promise(() => startBackgroundCli(logger))
    const wsl = yield* Effect.promise(() => startWsl(background, logger))
    wslIpc.set(wsl.ipc)
    wsl.start()
    lifecycle.setWslShutdown(wsl.stop)
    yield* Deferred.succeed(serverReady, {
      url: background.url,
      username: background.username,
      password: background.password,
    })
    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)
  if (lifecycle.restoreWindows().length) createMenu(menu)
})

Effect.runFork(main)
