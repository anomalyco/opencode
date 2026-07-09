export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { AppProcess } from "@opencode-ai/core/process"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { start } from "@opencode-ai/server/process"
import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"
import { Effect, Exit, FileSystem, Logger, Option, Redacted, Schedule, Schema, Scope } from "effect"
import { HttpServer } from "effect/unstable/http"
import { Env } from "./env"
import { ServiceConfig } from "./services/service-config"
import { Updater } from "./services/updater"

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
}

export const run = Effect.fn("cli.server-process.run")((options: Options) =>
  processEffect(options).pipe(
    Effect.provide(Updater.layer),
    Effect.provide(AppNodeBuilder.build(LayerNode.group([Global.node, AppProcess.node, EffectFlock.node]))),
    Effect.provide(NodeServices.layer),
  ),
)

const processEffect = Effect.fnUntraced(function* (options: Options) {
  if (options.mode === "service") yield* Effect.sync(() => process.chdir(Global.Path.home))
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const lockScope = serviceOptions === undefined ? undefined : yield* acquireServiceLock(serviceOptions.file)
      if (
        serviceOptions !== undefined &&
        lockScope !== undefined &&
        (yield* Service.discover(serviceOptions)) !== undefined
      ) {
        yield* Scope.close(lockScope, Exit.void)
        return
      }
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.OPENCODE_PASSWORD
        delete process.env.OPENCODE_SERVER_PASSWORD
      }
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const password =
        options.mode === "service"
          ? yield* ServiceConfig.password()
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      if (!password) return yield* Effect.fail(new Error("Missing server password"))
      const address = yield* start({
        hostname: options.hostname ?? config.hostname ?? "127.0.0.1",
        port: Option.fromNullishOr(options.port ?? config.port),
        password,
      }).pipe(Effect.provide(Logger.layer([], { mergeWithExisting: false })))
      if (lockScope !== undefined) {
        yield* register(address, password)
        yield* Scope.close(lockScope, Exit.void)
      }
      const url = HttpServer.formatAddress(address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (options.mode === "default" && !environmentPassword) console.log(`server password ${password}`)
      const updater = yield* Updater.Service
      yield* updater.check().pipe(Effect.schedule(Schedule.spaced("10 minutes")), Effect.forkScoped)
      return yield* options.mode === "stdio" ? waitForStdinClose() : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

const acquireServiceLock = Effect.fnUntraced(function* (file: string) {
  const flock = yield* EffectFlock.Service
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
  yield* flock
    .acquire(`service:${file}`, undefined, { staleMs: 3_000, timeoutMs: 3_000 })
    .pipe(Effect.provideService(Scope.Scope, scope))
  return scope
})

// The latest atomic registration wins. A displaced process notices the new id,
// exits, and cannot remove its successor's registration from its finalizer.
const infoJson = Schema.fromJsonString(Service.Info)
const encodeInfo = Schema.encodeEffect(infoJson)
const decodeInfo = Schema.decodeUnknownEffect(infoJson)

const register = Effect.fnUntraced(function* (address: HttpServer.Address, password: string) {
  const fs = yield* FileSystem.FileSystem
  const options = yield* ServiceConfig.options()
  const id = randomUUID()
  const temp = options.file + "." + id + ".tmp"
  yield* fs.makeDirectory(path.dirname(options.file), { recursive: true })
  const encoded = yield* encodeInfo({
    id,
    version: InstallationVersion,
    url: HttpServer.formatAddress(address),
    pid: process.pid,
    password,
  })
  yield* fs.writeFileString(temp, encoded, { mode: 0o600 })
  yield* fs.rename(temp, options.file)
  const currentID = fs.readFileString(options.file).pipe(
    Effect.flatMap(decodeInfo),
    Effect.map((info) => info.id),
    Effect.orElseSucceed(() => undefined),
  )
  yield* currentID.pipe(
    Effect.flatMap((current) =>
      current === id
        ? Effect.void
        : Effect.try({ try: () => process.kill(process.pid, "SIGTERM"), catch: (cause) => cause }).pipe(Effect.ignore),
    ),
    Effect.repeat(Schedule.spaced("10 seconds")),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() =>
    currentID.pipe(
      Effect.flatMap((current) => (current === id ? fs.remove(options.file) : Effect.void)),
      Effect.ignore,
    ),
  )
})

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}
