export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service, type DiscoverOptions, type Info } from "@opencode-ai/client/effect/service"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"
import { AppProcess } from "@opencode-ai/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"
import { Effect, FileSystem, Option, Redacted, Schedule, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { Env } from "./env"
import { ServiceConfig } from "./services/service-config"
import { Updater } from "./services/updater"
import { WebUi } from "./services/web-ui"

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
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), [
        [
          Global.node,
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ],
      ]),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const global = yield* Global.Service
  if (options.mode === "service") yield* Effect.sync(() => process.chdir(global.home))
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const port = options.port ?? config.port ?? (options.mode === "service" ? ServiceConfig.defaultPort() : undefined)
      const incumbent =
        serviceOptions !== undefined && port !== undefined
          ? yield* Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (incumbent !== undefined) return
      const { start } = yield* Effect.promise(() => import("@opencode-ai/server/process"))
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.OPENCODE_PASSWORD
        delete process.env.OPENCODE_SERVER_PASSWORD
      }
      const password =
        options.mode === "service"
          ? config.password || randomBytes(32).toString("base64url")
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      if (!password) return yield* Effect.fail(new Error("Missing server password"))
      const instanceID = randomUUID()
      const transform = yield* WebUi.handler()
      const server = yield* start(
        {
          app: {
            name: process.env.OPENCODE_CLIENT ?? "cli",
            version: OPENCODE_VERSION,
            channel: OPENCODE_CHANNEL,
          },
          hostname,
          port,
          password,
          simulation: truthy(process.env.OPENCODE_SIMULATE),
          database: {
            path:
              process.env.OPENCODE_DB ??
              (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
              process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
              process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
                ? "opencode.db"
                : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`),
          },
          models: {
            url: process.env.OPENCODE_MODELS_URL,
            file: process.env.OPENCODE_MODELS_PATH,
            fetch: !truthy(process.env.OPENCODE_DISABLE_MODELS_FETCH),
          },
          config: {
            directory: process.env.OPENCODE_CONFIG_DIR,
            project: !truthy(
              process.env.OPENCODE_CONFIG_PROJECT_DISABLE ?? process.env.OPENCODE_DISABLE_PROJECT_CONFIG,
            ),
            file: process.env.OPENCODE_CONFIG,
            content: process.env.OPENCODE_CONFIG_CONTENT,
          },
          windows: {
            gitbash: process.env.OPENCODE_GIT_BASH_PATH,
          },
          fs: {
            filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER),
            fff:
              process.env.OPENCODE_DISABLE_FFF === undefined
                ? process.platform !== "win32"
                : !truthy(process.env.OPENCODE_DISABLE_FFF),
          },
        },
        serviceOptions === undefined
          ? undefined
          : {
              onListen: (address, shutdown) =>
                Effect.gen(function* () {
                  if (!config.password) yield* ServiceConfig.password(password)
                  return yield* register(address, password, instanceID, serviceOptions.file, shutdown)
                }),
            },
        transform,
      ).pipe(
        Effect.catch((error) => {
          if (serviceOptions === undefined || port === undefined || !addressInUse(error)) return Effect.fail(error)
          return recognizeIncumbent(serviceOptions, hostname, port).pipe(
            Effect.flatMap((found) =>
              found
                ? Effect.void
                : Effect.fail(
                    new Error(
                      `Managed service port ${port} on ${hostname} is already in use by another process. ` +
                        "Configure another port with `opencode service set port <port>` and start the service again.",
                      { cause: error },
                    ),
                  ),
            ),
          )
        }),
      )
      if (server === undefined) return
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (foreground && !environmentPassword) console.log(`server password ${password}`)
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
  shutdown: Effect.Effect<void>,
) {
  const fs = yield* FileSystem.FileSystem
  const temp = file + "." + id + ".tmp"
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  const info = {
    id,
    version: OPENCODE_VERSION,
    url: HttpServer.formatAddress(address),
    pid: process.pid,
    password,
  }
  const encoded = yield* encodeInfo(info)
  const current = fs.readFileString(file).pipe(Effect.flatMap(decodeInfo))
  const owns = (found: Info) =>
    found.id === info.id &&
    found.version === info.version &&
    found.url === info.url &&
    found.pid === info.pid &&
    found.password === info.password
  yield* fs.writeFileString(temp, encoded, { mode: 0o600 }).pipe(Effect.andThen(fs.rename(temp, file)))
  yield* current.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("managed service registration check failed; shutting down", {
        cause,
        serviceID: id,
        servicePID: process.pid,
        registration: file,
      }).pipe(Effect.andThen(Effect.failCause(cause))),
    ),
    Effect.tap((found) =>
      owns(found)
        ? Effect.void
        : Effect.logWarning("managed service registration replaced; shutting down", {
            serviceID: id,
            servicePID: process.pid,
            registration: file,
            observedServiceID: found.id,
            observedServicePID: found.pid,
            observedVersion: found.version,
            observedURL: found.url,
          }),
    ),
    Effect.filterOrFail(owns),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.ignore,
    Effect.andThen(shutdown),
    Effect.forkScoped,
  )
  return current.pipe(
    Effect.flatMap((found) => (owns(found) ? fs.remove(file) : Effect.void)),
    Effect.ignore,
  )
})

const recognizeIncumbent = Effect.fnUntraced(function* (options: DiscoverOptions, hostname: string, port: number) {
  const found = yield* Service.incumbent({ ...options, url: serviceURL(hostname, port) }).pipe(
    Effect.filterOrFail((value) => value !== undefined),
    Effect.retry(Schedule.spaced("100 millis")),
    Effect.timeoutOption("15 seconds"),
  )
  return Option.isSome(found)
})

function serviceURL(hostname: string, port: number) {
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}

function addressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "EADDRINUSE") return true
  return "cause" in error && addressInUse(error.cause)
}

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
