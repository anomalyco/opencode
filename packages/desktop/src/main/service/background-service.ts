import { app } from "electron"
import { Clock, Context, Effect, FileSystem, Layer, Path } from "effect"
import { CHANNEL } from "../constants"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages, DesktopCli } from "./desktop-cli"
import { externalServerConfig } from "./external-server"
import { probe } from "./external-server-probe"
import { SidecarCredentials } from "./sidecar-credentials"

export * as BackgroundService from "./background-service"

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()
    return Service.of(
      yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: connect("reconnect").pipe(Effect.provide(context), Effect.orDie),
      }),
    )
  }),
)

const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  yield* Effect.logInfo("starting v2 background service")
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  // Every packaged install attaches to the external server; only the explicit dev-isolated mode
  // spawns and manages a local sidecar. The server may not be up yet when the app launches, so the
  // attach path waits for it forever instead of failing: the splash stays up until it answers.
  if (!isolated) {
    const external = externalServerConfig()
    const ready = { url: external.url, password: external.password } satisfies SidecarCredentials.Data
    yield* Effect.logInfo("attaching to external server", endpoint(external.url))
    if (external.password === null)
      yield* Effect.logWarning(
        "external server password is not configured; requests will fail with 401",
        endpoint(external.url),
      )
    yield* waitForExternalServer(external.url, external.password, 1, 0)
    yield* Effect.logInfo("external server is ready", endpoint(external.url))
    SidecarCredentials.set(ready)
    return ready
  }
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const cli = yield* desktopCli.resolve
  const version = mode === "initial" ? cli.version : undefined
  process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))
  // The client derives the registration filename from the channel (service-prod.json etc.), so the
  // desktop passes the channel. Isolated local mode has no matching channel value and keeps an
  // explicit file.
  const isolatedLocal = process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
  const file = isolatedLocal ? path.join(app.getPath("userData"), "opencode", "service-local.json") : undefined
  const channel = isolatedLocal ? undefined : CHANNEL
  const ensure = () =>
    client.Service.ensure({
      file,
      channel,
      version,
      command: [...cli.command, "serve", "--service", "--hostname", "0.0.0.0", "--port", "0"],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    })
  const service = yield* Effect.tryPromise(ensure)
  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("v2 CLI background service ready", {
    version,
    ...endpoint(url.origin),
  })
  if (mode === "initial" && cli.binary) yield* cleanStages(cli.binary).pipe(Effect.orDie)
  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)
  return ready
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}

// Retry cadence for the attach probe. 500ms keeps startup responsive once the server appears, while
// the 5s per-attempt timeout stops a hung connection from stalling the loop. Failures are logged on
// the first attempt and then at most every 30s, so a permanently-down server stays diagnosable
// without flooding the main-process log. This never fails: it only returns once the server is ready.
const probeInterval = "500 millis"
const probeTimeout = 5_000
const probeLogInterval = 30_000

function waitForExternalServer(
  url: string,
  password: string | null,
  attempt: number,
  lastLog: number,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => probe(url, password, probeTimeout))
    if (result.ready) return
    const now = yield* Clock.currentTimeMillis
    const log = attempt === 1 || now - lastLog >= probeLogInterval
    if (log) yield* Effect.logWarning("external server not ready; retrying", { url, attempt, reason: result.reason })
    yield* Effect.sleep(probeInterval)
    yield* waitForExternalServer(url, password, attempt + 1, log ? now : lastLog)
  })
}
