import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { app } from "electron"
import { Effect, Exit, Layer } from "effect"
import type { ServerReadyData } from "../shared/ipc-contract"
import { Ipc } from "./ipc"
import {
  acquireApplicationLock,
  configureApplication,
  loadProxyEnvironment,
  preferApplicationEnvironment,
  prepareApplicationEnvironment,
  prepareDesktop,
} from "./lifecycle/environment"
import { ApplicationLifecycle } from "./lifecycle"
import { initializeFirstLaunchOnboarding } from "./lifecycle/onboarding"
import { Shutdown } from "./lifecycle/shutdown"
import { DesktopLogging } from "./native/logging"
import { startBackgroundCli } from "./service/background-service"
import { Updater } from "./updater"

const runApplication = Effect.gen(function* () {
  yield* initializeFirstLaunchOnboarding(app.getPath("userData"))
  yield* prepareApplicationEnvironment
  yield* preferApplicationEnvironment
  yield* Effect.promise(() => app.whenReady())
  yield* prepareDesktop
  yield* runDesktop.pipe(Effect.provide(Updater.layer))
})

const runDesktop = Effect.gen(function* () {
  const logging = yield* DesktopLogging.Service
  yield* logging.startNetwork
  yield* loadProxyEnvironment
  yield* Effect.logInfo("starting v2 background service")
  const loading = yield* startBackgroundCli().pipe(Effect.exit)
  const initialization = Exit.isSuccess(loading)
    ? Effect.succeed({
        url: loading.value.url,
        username: loading.value.username,
        password: loading.value.password,
      } satisfies ServerReadyData)
    : Effect.failCause(loading.cause).pipe(Effect.orDie)

  yield* runIpc(Exit.isSuccess(loading)).pipe(
    Effect.provide(Ipc.layer(initialization, Exit.isSuccess(loading) ? loading.value : undefined)),
  )
})

const runIpc = Effect.fn("Desktop.runIpc")(function* (loaded: boolean) {
  const lifecycle = yield* ApplicationLifecycle.Service
  const ipc = yield* Ipc.registerIpcHandlers
  if (loaded) yield* Effect.logInfo("loading task finished")
  if (lifecycle.restoreWindows().length) ipc.installMenu()
  yield* Effect.callback<void>((resume) => {
    const quit = () => resume(Effect.void)
    app.once("will-quit", quit)
    return Effect.sync(() => app.off("will-quit", quit))
  })
})

const platform = Layer.merge(DesktopLogging.layer, Shutdown.layer).pipe(
  Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
)

const main = Effect.gen(function* () {
  if (!acquireApplicationLock()) return
  yield* configureApplication()
  yield* runApplication
})

main.pipe(
  Effect.provide(ApplicationLifecycle.layer.pipe(Layer.provideMerge(platform))),
  Effect.scoped,
  NodeRuntime.runMain,
)
