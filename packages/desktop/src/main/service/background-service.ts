import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { CHANNEL } from "../constants"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages } from "./cli-stages"
import { keptStages, serviceVersion, shouldRetryEnsure } from "./cli-version"
import { DesktopCli } from "./desktop-cli"
import { SidecarCredentials } from "./sidecar-credentials"
import { sidecarProbe } from "./sidecar-probe"

export * as BackgroundService from "./background-service"

const RegisteredService = Schema.Struct({ version: Schema.optional(Schema.String) })

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
  /** Stops the registered background service and its terminals. */
  readonly stop: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

// A tray quit stops the service for good. A renderer that notices the disconnect must not make the
// app start a replacement it would immediately leave behind.
let stopping = false

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()
    const path = yield* Path.Path

    return Service.of({
      ...(yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: Effect.suspend(() => {
          const cached = SidecarCredentials.get()

          if (stopping && cached) return Effect.succeed(cached)

          return connect("reconnect")
        }).pipe(Effect.provide(context), Effect.orDie),
      })),
      stop: Effect.suspend(() => stopService(path)),
    })
  }),
)

const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  yield* Effect.logInfo("starting v2 background service")
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>())
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const cli = yield* desktopCli.resolve
  const version = serviceVersion({ channel: CHANNEL, isolated, mode, version: cli.version })

  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  const file = registrationFile(path)

  const ensure = (required = version) =>
    client.Service.ensure({
      file,
      version: required,
      // A fixed port makes a second contender fail to bind and back off; port 0 never collides, so two
      // services could boot against the same database.
      command: [
        ...cli.command,
        "serve",
        "--service",
        ...(isolated ? ["--hostname", "0.0.0.0", "--port", String(0x0c0c)] : []),
      ],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    })

  const runEnsure = () =>
    ensure().catch((error) => {
      if (!shouldRetryEnsure(version, error instanceof Error ? error.message : String(error))) throw error

      return ensure(cli.version)
    })

  // A compatible service the entry module already found is adopted at once; ensure() still runs
  // afterwards for its side effects (terminal handoff completion), off the renderer's path.
  const early = mode === "initial" && !isolated ? yield* Effect.promise(sidecarProbe) : undefined

  if (early) yield* Effect.sync(() => void runEnsure().catch(() => undefined))
  const service = early ?? (yield* Effect.tryPromise(runEnsure))

  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)

  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"

  const runningVersion = yield* fs.readFileString(file ?? client.fallback()).pipe(
    Effect.map(
      (text) =>
        Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(RegisteredService))(text))?.version,
    ),
    Effect.orElseSucceed(() => undefined),
  )

  yield* Effect.logInfo("v2 CLI background service ready", {
    version,
    runningVersion,
    probed: !!early,
    ...endpoint(url.origin),
  })

  // Only packaged and isolated builds run a staged copy; any other binary sits in the source tree.
  // Keep both the bundled stage and any adopted server's stage so its executable stays on disk.
  if (mode === "initial" && (app.isPackaged || isolated) && cli.binary && runningVersion)
    runFork(
      cleanStages(cli.binary, { keep: keptStages(cli.version, runningVersion) }).pipe(
        Effect.catch((error) => Effect.logError("failed to clean staged v2 CLIs", { error })),
      ),
    )

  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)

  return ready
})

/** Stops the registered service so a full quit leaves no detached server or terminals behind. */
const stopService = Effect.fn("BackgroundService.stop")(function* (path: Path.Path) {
  stopping = true

  if (!app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1")
    process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  yield* Effect.tryPromise(() => client.Service.stop({ file: registrationFile(path), pty: "clear" })).pipe(
    Effect.catch((error) => Effect.logWarning("failed to stop v2 background service", { error })),
  )
})

/** The registration file the service writes; `local` channels keep their own instance. */
const registrationFile = (path: Path.Path) =>
  process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
    ? path.join(
        process.env.XDG_STATE_HOME ?? path.join(app.getPath("home"), ".local", "state"),
        "opencode",
        "service-local.json",
      )
    : undefined

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)

  return { url, hostname: parsed.hostname, port: parsed.port }
}
