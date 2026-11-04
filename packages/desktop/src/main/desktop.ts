import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { app } from "electron"
import { Effect, Layer, Path } from "effect"
import { Plugins } from "./plugin"
import { Ipc } from "./ipc"
import { DesktopInitialization } from "./lifecycle/desktop-initialization"
import { installContextMenu } from "./lifecycle/environment"
import { ApplicationLifecycle } from "./lifecycle"
import { DesktopLogging } from "./native/logging"
import { installTray } from "./native/tray"
import { DesktopPaths } from "./paths"
import { BackgroundService } from "./service/background-service"
import { DesktopCli } from "./service/desktop-cli"
import { marks } from "./lifecycle/marks"
import { setAppQuitting, setHideOnClose } from "./windows"
import { trayIconPath } from "./windows/appearance"

// Everything above has been loaded and evaluated by now; the layers start below.
marks.bundle = Date.now()

const runIpc = Effect.fn("Desktop.runIpc")(function* () {
  const lifecycle = yield* ApplicationLifecycle.Service
  const plugins = yield* Plugins.Service
  const background = yield* BackgroundService.Service
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const runFork = Effect.runForkWith(yield* Effect.context())
  marks.layers = Date.now()
  yield* Effect.logInfo("layers ready", { marks })
  const ipc = yield* Ipc.registerIpcHandlers

  // A tray quit stops the background service, then quits. Quitting without that keeps the service
  // and its terminals for the next launch, which is what every other quit path does.
  const quit = yield* Effect.cached(
    background.stop.pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.logWarning("background service did not stop, quitting anyway"),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setAppQuitting()
          app.quit()
        }),
      ),
    ),
  )

  // A desktop without a status notifier cannot host the icon, and losing the main process over it
  // would be worse than running without a tray.
  const disposeTray = yield* Effect.try(() =>
    installTray({
      icon: trayIconPath(path, paths),
      onShow: lifecycle.showWindow,
      onQuit: () => runFork(quit),
    }),
  ).pipe(Effect.catch((error) => Effect.logWarning("failed to install tray", { error }).pipe(Effect.as(undefined))))

  // Without an icon the tray cannot bring the app back, so closing the last window keeps quitting.
  setHideOnClose(disposeTray !== undefined)

  yield* Effect.addFinalizer(() => Effect.sync(() => disposeTray?.()))

  // Main GUI plugins start with the window: servers they restore feed the first paint's server
  // list, and menu items they contribute are present at startup. Their heavy modules load lazily on
  // first use.
  yield* Effect.forkScoped(plugins.start)

  if (lifecycle.restoreWindows().length) ipc.installMenu()
  // The first window's renderer now has its IPC port and is hydrating its stores over it. The crash
  // reporter (spawns a process) and the context menu (a dependency tree) are not worth answering late.
  yield* Effect.sleep("500 millis")
  const logging = yield* DesktopLogging.Service
  yield* logging.startCrashReporter
  yield* installContextMenu
  yield* Effect.callback<void>((resume) => {
    const onWillQuit = () => resume(Effect.void)
    app.once("will-quit", onWillQuit)

    return Effect.sync(() => app.off("will-quit", onWillQuit))
  })
})

runIpc().pipe(
  Effect.provide(Ipc.layer),
  Effect.provide(BackgroundService.layer),
  Effect.provide(DesktopCli.layer),
  Effect.provide(DesktopInitialization.layer),
  Effect.provide(ApplicationLifecycle.layer),
  Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
  Effect.scoped,
  NodeRuntime.runMain,
)
