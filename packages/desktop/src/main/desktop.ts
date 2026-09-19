import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { app } from "electron"
import { Effect, Layer } from "effect"
import { Ipc } from "./ipc"
import { DesktopInitialization } from "./lifecycle/desktop-initialization"
import { installContextMenu } from "./lifecycle/environment"
import { ApplicationLifecycle } from "./lifecycle"
import { DesktopLogging } from "./native/logging"
import { BackgroundService } from "./service/background-service"
import { DesktopCli } from "./service/desktop-cli"
import { UpdaterLive } from "./updater/live"
import { marks } from "./lifecycle/marks"

// Everything above has been loaded and evaluated by now; the layers start below.
marks.bundle = Date.now()

const runIpc = Effect.fn("Desktop.runIpc")(function* () {
  const lifecycle = yield* ApplicationLifecycle.Service
  marks.layers = Date.now()
  yield* Effect.logInfo("layers ready", { marks })
  const ipc = yield* Ipc.registerIpcHandlers
  if (lifecycle.restoreWindows().length) ipc.installMenu()
  // The first window's renderer now has its IPC port and is hydrating its stores over it. The crash
  // reporter (spawns a process) and the context menu (a dependency tree) are not worth answering late.
  yield* Effect.sleep("500 millis")
  const logging = yield* DesktopLogging.Service
  yield* logging.startCrashReporter
  yield* installContextMenu
  yield* Effect.callback<void>((resume) => {
    const quit = () => resume(Effect.void)
    app.once("will-quit", quit)
    return Effect.sync(() => app.off("will-quit", quit))
  })
})

runIpc().pipe(
  Effect.provide(Ipc.layer),
  Effect.provide(BackgroundService.layer),
  Effect.provide(DesktopCli.layer),
  Effect.provide(UpdaterLive.layer),
  Effect.provide(DesktopInitialization.layer),
  Effect.provide(ApplicationLifecycle.layer),
  Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
  Effect.scoped,
  NodeRuntime.runMain,
)
