export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/effect/service"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { AppProcess } from "@opencode-ai/core/process"
import { ProcessLock } from "@opencode-ai/core/util/process-lock"
import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"
import { Effect, FileSystem, Logger, Option, Redacted, Schedule, Schema } from "effect"
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

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(Updater.layer),
    Effect.provide(AppNodeBuilder.build(LayerNode.group([Global.node, AppProcess.node]))),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  if (options.mode === "service") yield* Effect.sync(() => process.chdir(Global.Path.home))
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      if (serviceOptions !== undefined) {
        const acquired = yield* ProcessLock.acquire(serviceOptions.file + ".lock").pipe(
          Effect.as(true),
          Effect.catchTag("ProcessLockHeldError", () => Effect.succeed(false)),
        )
        if (!acquired) return yield* Effect.void
        if ((yield* Service.discover(serviceOptions)) !== undefined) return yield* Effect.void
      }
      const { start } = yield* Effect.promise(() => import("@opencode-ai/server/process"))
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
      const instanceID = randomUUID()
      const server = yield* start({
        hostname: options.hostname ?? config.hostname ?? "127.0.0.1",
        port: Option.fromNullishOr(options.port ?? config.port),
        password,
        instanceID,
        service:
          serviceOptions === undefined
            ? undefined
            : { onListen: (address) => register(address, password, instanceID, serviceOptions.file) },
      }).pipe(Effect.provide(Logger.layer([], { mergeWithExisting: false })))
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (options.mode === "default" && !environmentPassword) console.log(`server password ${password}`)
      const updater = yield* Updater.Service
      yield* updater.check().pipe(Effect.schedule(Schedule.spaced("10 minutes")), Effect.forkScoped)
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

const infoJson = Schema.fromJsonString(Service.Info)
const encodeInfo = Schema.encodeEffect(infoJson)
const decodeInfo = Schema.decodeUnknownEffect(infoJson)

const register = Effect.fnUntraced(function* (
  address: HttpServer.Address,
  password: string,
  id: string,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem
  const temp = file + "." + id + ".tmp"
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  const info = {
    id,
    version: InstallationVersion,
    url: HttpServer.formatAddress(address),
    pid: process.pid,
    password,
  }
  const encoded = yield* encodeInfo(info)
  const publish = fs.writeFileString(temp, encoded, { mode: 0o600 }).pipe(Effect.andThen(fs.rename(temp, file)))
  yield* publish
  const current = fs.readFileString(file).pipe(
    Effect.flatMap(decodeInfo),
    Effect.orElseSucceed(() => undefined),
  )
  const assertRegistration = Effect.gen(function* () {
    const found = yield* current
    if (
      found !== undefined &&
      found.id === info.id &&
      found.version === info.version &&
      found.url === info.url &&
      found.pid === info.pid &&
      found.password === info.password
    )
      return
    yield* publish
  })
  yield* Effect.addFinalizer(() =>
    current.pipe(
      Effect.flatMap((current) => (current?.id === id ? fs.remove(file) : Effect.void)),
      Effect.ignore,
    ),
  )
  yield* assertRegistration.pipe(
    Effect.catchCause((cause) => Effect.logWarning("failed to reassert service registration", { cause })),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.forkScoped,
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
