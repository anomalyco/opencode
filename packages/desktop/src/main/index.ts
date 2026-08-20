import { app } from "electron"
import { Deferred, Effect, Fiber } from "effect"
import type { ServerReadyData } from "../shared/ipc-contract"
import { checkAppExists, resolveAppPath } from "./files/apps"
import {
  registerIpcHandlers,
  registerUpdaterIpcHandlers,
  registerWslInitialization,
  registerWslIpcHandlers,
} from "./ipc"
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

const main = Effect.gen(function* () {
  const logger = configureApplication()
  if (!acquireApplicationLock()) return
  preferApplicationEnvironment(logger)
  loadProxyEnvironment(logger)
  const lifecycle = createApplicationLifecycle(logger)
  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()
  const wslReady = Promise.withResolvers<void>()
  logger.log("starting v2 background service")
  const backgroundTask = yield* Effect.promise(() => startBackgroundCli(logger)).pipe(Effect.forkChild)

  yield* Effect.promise(() => app.whenReady())
  yield* prepareDesktop(logger)

  const updater = yield* Effect.promise(() => setupAutoUpdater(lifecycle.prepareToRestart))
  const menu = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater),
    relaunch: lifecycle.relaunch,
  }
  registerIpcHandlers({
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
  })
  registerUpdaterIpcHandlers(createUpdaterIpc(updater))
  registerWslInitialization(wslReady.promise)
  startAutoUpdater(updater)
  yield* Effect.promise(() => startNetworkLogging())

  const loadingTask = yield* Effect.gen(function* () {
    const background = yield* Fiber.join(backgroundTask)
    yield* Deferred.succeed(serverReady, {
      url: background.url,
      username: background.username,
      password: background.password,
    })
    logger.log("loading task finished")

    void startWsl(background, logger).then(
      (wsl) => {
        registerWslIpcHandlers(wsl.ipc)
        lifecycle.setWslShutdown(wsl.stop)
        wsl.start()
        wslReady.resolve()
      },
      (error) => {
        logger.error("failed to start WSL manager", { error })
        wslReady.reject(error)
      },
    )
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  if (lifecycle.restoreWindows().length) createMenu(menu)
  yield* Fiber.await(loadingTask)
})

Effect.runFork(main)
