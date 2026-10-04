export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service, type DiscoverOptions } from "@opencode/client/effect/service"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"
import { AppProcess } from "@opencode/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import { createConnection } from "node:net"
import { Effect, Option, Redacted, Result, Schedule, Schema } from "effect"
import { PersistentPty } from "@opencode/schema/persistent-pty"
import { HttpServer } from "effect/unstable/http"
import { Env } from "./env"
import { ServiceConfig } from "./services/service-config"
import { RetainedImage } from "./services/retained-image"
import { ServiceRegistration } from "./services/service-registration"
import { WebUi } from "./services/web-ui"
import { databasePath } from "./database-path"

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
  readonly cors?: readonly string[]
}

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
        replacements: [
          Global.node.replace(
            Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
          ),
        ],
      }),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const inherited = process.env.OPENCODE_PTY_HANDOFF
  delete process.env.OPENCODE_PTY_HANDOFF
  const handoff =
    inherited === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistentPty.Handoff))(inherited).pipe(
          Effect.catch(() =>
            Effect.logWarning("Ignoring invalid PTY restart handoff; persistent terminals will start fresh").pipe(
              Effect.as(undefined),
            ),
          ),
        )
  const global = yield* Global.Service
  if (options.mode === "service") yield* Effect.sync(() => process.chdir(global.home))
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const configuredPort = options.port ?? config.port
      const port =
        configuredPort ??
        (options.mode === "service"
          ? ServiceConfig.defaultPort(OPENCODE_CHANNEL, process.env.WSL_DISTRO_NAME)
          : undefined)
      const incumbent =
        serviceOptions !== undefined && port !== undefined
          ? yield* Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (incumbent !== undefined) return
      // Keep a package-manager or curl install replaceable while the service runs; Desktop updates its own copy.
      if (options.mode === "service" && process.platform === "win32" && RetainedImage.installed(global.home))
        yield* RetainedImage.retain(global.cache, "service")
      const { start } = yield* Effect.promise(() => import("@opencode/server/process"))
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
      const launch = (candidate: number | undefined) =>
        start(
          {
            app: {
              name: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
              version: OPENCODE_VERSION,
              channel: OPENCODE_CHANNEL,
            },
            hostname,
            port: candidate,
            cors: options.cors ?? config.cors,
            password,
            pty: { handoff },
            simulation: truthy(process.env.OPENCODE_SIMULATE),
            database: {
              path: databasePath(global.data),
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
              filewatcher: !truthy(
                process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER,
              ),
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
                    return yield* ServiceRegistration.register({
                      address,
                      password,
                      id: instanceID,
                      file: serviceOptions.file,
                      shutdown,
                    })
                  }),
              },
          transform,
        )
      const server = yield* serviceOptions === undefined || port === undefined
        ? launch(port)
        : claimServicePort({ options: serviceOptions, hostname, port, movable: configuredPort === undefined, launch })
      if (server === undefined) return
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (foreground && !environmentPassword) console.log(`server password ${password}`)
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

// The service port elects one service per database: a contender that cannot bind it waits for the sibling
// holding it to register, then exits. Hyper-V reserves blocks of the Windows ephemeral range, which holds
// the channel default, and a reserved port refuses connections, so no sibling can hold it. An unconfigured
// service skips such ports; every contender skips the same ones and still meets at the first bindable port.
const claimServicePort = Effect.fnUntraced(function* <A, E, R>(input: {
  readonly options: DiscoverOptions
  readonly hostname: string
  readonly port: number
  readonly movable: boolean
  readonly launch: (port: number) => Effect.Effect<A, E, R>
}) {
  let port = input.port
  let released = false
  while (port <= 65_535) {
    const result = yield* Effect.result(input.launch(port))
    if (Result.isSuccess(result)) {
      if (port !== input.port)
        yield* Effect.logWarning("managed service port is reserved; using the next free port", {
          hostname: input.hostname,
          preferred: input.port,
          port,
        })
      return result.success
    }
    // Node reports Windows excluded ranges as EACCES; Bun reports them as EADDRINUSE.
    if (!hasCode(result.failure, "EADDRINUSE") && !(input.movable && hasCode(result.failure, "EACCES")))
      return yield* Effect.fail(result.failure)
    if (input.movable && (yield* refused(input.hostname, port))) {
      // A holder that just exited refuses connections too, so a port is skipped only once it refuses twice.
      port = released ? port + 1 : port
      released = !released
      continue
    }
    if (yield* recognizeIncumbent(input.options, input.hostname, port)) return undefined
    return yield* Effect.fail(
      new Error(
        `Managed service port ${port} on ${input.hostname} is already in use by another process. ` +
          "Configure another port with `opencode service set port <port>` and start the service again.",
        { cause: result.failure },
      ),
    )
  }
  return yield* Effect.fail(new Error(`No managed service port is available on ${input.hostname}`))
})

// A sibling binds the same hostname and accepts connections as soon as it binds. Only an explicit refusal
// rules one out; a timeout or any other failure leaves the port to incumbent recognition.
function refused(hostname: string, port: number) {
  const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname
  return Effect.tryPromise(
    (signal) =>
      new Promise<boolean>((resolve) => {
        const socket = createConnection({ host, port, signal })
        socket.once("connect", () => {
          socket.destroy()
          resolve(false)
        })
        socket.once("error", (error) => resolve(hasCode(error, "ECONNREFUSED")))
      }),
  ).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map(Option.getOrElse(() => false)),
    Effect.orElseSucceed(() => false),
  )
}

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

function hasCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === code) return true
  return "cause" in error && hasCode(error.cause, code)
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
