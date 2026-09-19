import { homedir } from "node:os"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages, DesktopCli } from "./desktop-cli"
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
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  // A source-built server joins the TUI's `bun dev` service: the same `service-local.json` and the
  // fixed local port, which is the lock between service contenders. A downloaded development server
  // stays isolated in userData on a random port so it never replaces the installed service.
  const local = !app.isPackaged && process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
  const isolated = !app.isPackaged && !local && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const cli = yield* desktopCli.resolve
  const version = mode === "initial" ? cli.version : undefined
  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))
  const service = yield* Effect.tryPromise(() =>
    client.Service.ensure({
      file: local
        ? path.join(
            process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"),
            "opencode",
            "service-local.json",
          )
        : undefined,
      version,
      command: [...cli.command, "serve", "--service", ...(isolated ? ["--port", "0"] : [])],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    }),
  )
  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("v2 CLI background service ready", {
    version,
    ...endpoint(url.origin),
  })
  if (mode === "initial" && isolated && cli.binary) yield* cleanStages(cli.binary).pipe(Effect.orDie)
  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)
  return ready
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}
