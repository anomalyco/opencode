import { app } from "electron"
import type { Endpoint } from "@opencode/client/service"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { SidecarChanged } from "../../shared/ipc-rpc/events"
import { CHANNEL } from "../constants"
import { emitIpcEvent } from "../ipc-events"
import { ApplicationLifecycle } from "../lifecycle"
import { stopsForQuit } from "../lifecycle/machine"
import { Shutdown } from "../lifecycle/shutdown"
import { getMainWindows } from "../windows"
import { BackgroundServiceMachine } from "./background-service-machine"
import { cleanStages } from "./cli-stages"
import { keptStages, serviceVersion, shouldRetryEnsure } from "./cli-version"
import { DesktopCli } from "./desktop-cli"
import { QuitBehavior } from "./quit-behavior"
import { SidecarCredentials } from "./sidecar-credentials"
import { takeSidecarProbe } from "./sidecar-probe"

export * as BackgroundService from "./background-service"

const RegisteredService = Schema.Struct({ version: Schema.optional(Schema.String) })

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()
    const lifecycle = yield* ApplicationLifecycle.Service
    const shutdown = yield* Shutdown.Service

    const machine = yield* BackgroundServiceMachine.make({
      probe: probe().pipe(Effect.provide(context)),
      ensure: (mode) => ensure(mode).pipe(Effect.provide(context)),
      publish: (data) => {
        SidecarCredentials.set(data)
        // Every window moves its requests and event stream to the new origin, not only the one that reconnected.
        const event = new SidecarChanged({ url: data.url })
        getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
      },
    })

    // The service outlives the app by default, so agents keep working after quit. A restart handoff or a relaunch
    // keeps it either way.
    const remove = yield* shutdown.add({
      stop: Effect.suspend(() =>
        stopsForQuit(lifecycle.state()) && !QuitBehavior.getKeepServiceRunning()
          ? machine.dispose.pipe(Effect.andThen(stop().pipe(Effect.provide(context))))
          : Effect.void,
      ),
      resume: Effect.void,
    })

    yield* Effect.addFinalizer(() => Effect.sync(remove))

    return Service.of({ connection: machine.connection, reconnect: machine.reconnect })
  }),
)

const stop = Effect.fn("BackgroundService.stop")(function* () {
  yield* Effect.logInfo("stopping v2 background service on quit")
  const path = yield* Path.Path
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  yield* Effect.tryPromise(() => client.Service.stop({ file: registrationFile(path) })).pipe(
    Effect.catch((error) => Effect.logError("failed to stop v2 background service on quit", { error })),
  )
})

function registrationFile(path: Path.Path) {
  if (process.env.OPENCODE_DESKTOP_SERVER_CHANNEL !== "local") return undefined

  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(app.getPath("home"), ".local", "state"),
    "opencode",
    "service-local.json",
  )
}

// A compatible service the entry module already found is adopted at once; the machine still verifies it with
// `ensure("initial")` (which also completes a terminal handoff), off the renderer's path.
const probe = Effect.fn("BackgroundService.probe")(function* () {
  const service = yield* Effect.promise(takeSidecarProbe)

  if (!service) return undefined
  const setup = yield* prepare("initial")

  return (yield* adopt(setup, service, true)).credentials
})

const ensure = Effect.fn("BackgroundService.ensure")(function* (mode: BackgroundServiceMachine.ConnectMode) {
  const runFork = Effect.runForkWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>())
  const setup = yield* prepare(mode)

  const run = (version = setup.version) =>
    setup.client.Service.ensure({
      file: setup.file,
      version,
      // A fixed port makes a second contender fail to bind and back off; port 0 never collides, so two
      // services could boot against the same database.
      command: [
        ...setup.cli.command,
        "serve",
        "--service",
        ...(setup.isolated ? ["--hostname", "0.0.0.0", "--port", String(0x0c0c)] : []),
      ],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    })

  const service = yield* Effect.tryPromise(() =>
    run().catch((error) => {
      if (!shouldRetryEnsure(setup.version, error instanceof Error ? error.message : String(error))) throw error

      return run(setup.cli.version)
    }),
  )

  const ready = yield* adopt(setup, service, false)

  // Only packaged and isolated builds run a staged copy; any other binary sits in the source tree.
  // Keep both the bundled stage and the running server's stage so its executable stays on disk. This runs only
  // once `Service.ensure` settled which server runs, never for a probed one it may still replace.
  if (mode === "initial" && (app.isPackaged || setup.isolated) && setup.cli.binary && ready.runningVersion)
    runFork(
      cleanStages(setup.cli.binary, { keep: keptStages(setup.cli.version, ready.runningVersion) }).pipe(
        Effect.catch((error) => Effect.logError("failed to clean staged v2 CLIs", { error })),
      ),
    )

  return ready.credentials
})

const prepare = Effect.fn("BackgroundService.prepare")(function* (mode: BackgroundServiceMachine.ConnectMode) {
  yield* Effect.logInfo("starting v2 background service")
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const cli = yield* desktopCli.resolve
  const version = serviceVersion({ channel: CHANNEL, isolated, mode, version: cli.version })

  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  const file = registrationFile(path)

  return { cli, client, file, isolated, version }
})

const adopt = Effect.fn("BackgroundService.adopt")(function* (
  setup: Effect.Success<ReturnType<typeof prepare>>,
  service: Endpoint,
  probed: boolean,
) {
  const fs = yield* FileSystem.FileSystem

  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)

  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"

  const runningVersion = yield* fs.readFileString(setup.file ?? setup.client.fallback()).pipe(
    Effect.map(
      (text) =>
        Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(RegisteredService))(text))?.version,
    ),
    Effect.orElseSucceed(() => undefined),
  )

  yield* Effect.logInfo("v2 CLI background service ready", {
    version: setup.version,
    runningVersion,
    probed,
    ...endpoint(url.origin),
  })

  return {
    credentials: { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data,
    runningVersion,
  }
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)

  return { url, hostname: parsed.hostname, port: parsed.port }
}
