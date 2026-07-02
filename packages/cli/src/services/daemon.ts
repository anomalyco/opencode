import { Global } from "@opencode-ai/core/global"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Context, Effect, FileSystem, Layer, Option, Schedule, Schema, Scope } from "effect"
import { HttpServer } from "effect/unstable/http"
import { randomBytes, randomUUID } from "crypto"
import { spawn } from "node:child_process"
import path from "path"

export interface Interface {
  readonly client: () => Effect.Effect<ReturnType<typeof createOpencodeClient>, unknown>
  readonly transport: () => Effect.Effect<{ url: string; headers: RequestInit["headers"] }, unknown>
  readonly start: () => Effect.Effect<string, Error>
  readonly status: () => Effect.Effect<string | undefined>
  readonly stop: () => Effect.Effect<void, unknown>
  readonly password: (value?: string) => Effect.Effect<string, unknown>
  readonly config: () => Effect.Effect<ServiceConfig, unknown>
  readonly get: (key?: string) => Effect.Effect<string, unknown>
  readonly set: (key: string, value: string) => Effect.Effect<void, unknown>
  readonly unset: (key: string) => Effect.Effect<void, unknown>
  readonly register: (address: HttpServer.Address) => Effect.Effect<void, unknown, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Daemon") {}

const Registration = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
})
type Registration = typeof Registration.Type

const ServiceConfig = Schema.Struct({
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  autostart: Schema.optional(Schema.Boolean),
})
export type ServiceConfig = typeof ServiceConfig.Type

const serviceConfigKeys = ["hostname", "port", "password", "autostart"] as const
type ServiceConfigKey = (typeof serviceConfigKeys)[number]

function serviceConfigKey(key: string): ServiceConfigKey {
  if (serviceConfigKeys.includes(key as ServiceConfigKey)) return key as ServiceConfigKey
  throw new Error(`Unknown service config key: ${key}`)
}

function sameRegistration(left: Registration, right: Registration) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const directory = global.state
    const filename = InstallationChannel === "local" ? "service-local.json" : "service.json"
    const file = path.join(directory, filename)
    const configFile = path.join(global.config, filename)
    const decodeRegistration = Schema.decodeUnknownEffect(Schema.fromJsonString(Registration))
    const decodeServiceConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(ServiceConfig))

    const config = Effect.fn("cli.daemon.config")(function* () {
      return yield* fs.readFileString(configFile).pipe(
        Effect.flatMap(decodeServiceConfig),
        Effect.catch(() => Effect.succeed({} as ServiceConfig)),
      )
    })

    const writeConfig = Effect.fn("cli.daemon.writeConfig")(function* (value: ServiceConfig) {
      const temp = configFile + ".tmp"
      yield* fs.makeDirectory(path.dirname(configFile), { recursive: true })
      yield* fs.writeFileString(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
      yield* fs.rename(temp, configFile)
    })

    const password = Effect.fn("cli.daemon.password")(function* (value?: string) {
      const existing = yield* config()
      if (value === undefined && existing.password) return existing.password
      const next = value ?? randomBytes(32).toString("base64url")

      // Keep one private credential across server restarts so discovered clients
      // can reconnect without exposing a password flag or environment variable.
      yield* writeConfig({ ...existing, password: next })
      return next
    })

    const get = Effect.fn("cli.daemon.get")(function* (key?: string) {
      if (key === undefined) {
        const { password: _password, ...safe } = yield* config()
        return JSON.stringify(safe, null, 2)
      }
      switch (serviceConfigKey(key)) {
        case "hostname": {
          return (yield* config()).hostname ?? ""
        }
        case "port": {
          const port = (yield* config()).port
          return port === undefined ? "" : String(port)
        }
        case "password": {
          return yield* password()
        }
        case "autostart": {
          const autostart = (yield* config()).autostart
          return autostart === undefined ? "" : String(autostart)
        }
      }
    })

    const set = Effect.fn("cli.daemon.set")(function* (key: string, value: string) {
      switch (serviceConfigKey(key)) {
        case "hostname": {
          yield* stop()
          yield* writeConfig({ ...(yield* config()), hostname: value })
          return
        }
        case "port": {
          const port = Number(value)
          if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535")
          yield* stop()
          yield* writeConfig({ ...(yield* config()), port })
          return
        }
        case "password": {
          yield* stop()
          yield* password(value)
          return
        }
        case "autostart": {
          if (value !== "true" && value !== "false") throw new Error("Autostart must be true or false")
          yield* writeConfig({ ...(yield* config()), autostart: value === "true" })
          return
        }
      }
    })

    const unset = Effect.fn("cli.daemon.unset")(function* (key: string) {
      switch (serviceConfigKey(key)) {
        case "hostname": {
          yield* stop()
          const { hostname: _hostname, ...next } = yield* config()
          yield* writeConfig(next)
          return
        }
        case "port": {
          yield* stop()
          const { port: _port, ...next } = yield* config()
          yield* writeConfig(next)
          return
        }
        case "password": {
          yield* stop()
          const { password: _password, ...next } = yield* config()
          yield* writeConfig(next)
          return
        }
        case "autostart": {
          const { autostart: _autostart, ...next } = yield* config()
          yield* writeConfig(next)
          return
        }
      }
    })

    const registration = Effect.fnUntraced(function* () {
      return yield* fs.readFileString(file).pipe(Effect.flatMap(decodeRegistration))
    })

    const createClient = Effect.fnUntraced(function* (url: string) {
      return createOpencodeClient({ baseUrl: url, headers: ServerAuth.headers({ password: yield* password() }) })
    })

    const healthy = Effect.fnUntraced(function* () {
      const info = yield* registration()
      const client = yield* createClient(info.url)
      const response = yield* Effect.tryPromise(() => client.v2.health.get({ signal: AbortSignal.timeout(2_000) }))
      if (response.data?.healthy === true) return info
      return yield* Effect.fail(new Error("Registered server is not healthy"))
    })

    const remoteTransport = Effect.fn("cli.daemon.remoteTransport")(function* (input: ServiceConfig) {
      const url = serviceURL(input)
      const headers = ServerAuth.headers({ password: input.password })
      const response = yield* Effect.tryPromise(() =>
        createOpencodeClient({ baseUrl: url, headers }).v2.health.get({ signal: AbortSignal.timeout(2_000) }),
      )
      if (response.data?.healthy === true) return { url, headers }
      return yield* Effect.fail(new Error(`Server is not healthy: ${url}`))
    })

    const compatible = Effect.fnUntraced(function* () {
      const info = yield* healthy()
      if (info.version === InstallationVersion) return info
      return yield* Effect.fail(new Error("Registered server version does not match the client"))
    })

    const signal = (pid: number, signal: NodeJS.Signals) =>
      Effect.try({ try: () => process.kill(pid, signal), catch: (cause) => cause }).pipe(Effect.ignore)

    const awaitStopped = Effect.fnUntraced(function* (pid: number) {
      const running = yield* Effect.try({ try: () => process.kill(pid, 0), catch: () => false }).pipe(
        Effect.orElseSucceed(() => false),
      )
      if (!running) return true
      return yield* Effect.fail(new Error(`Server process ${pid} is still running`))
    })

    const stopProcess = Effect.fnUntraced(function* (info: Registration) {
      const current = yield* healthy().pipe(Effect.option)
      if (Option.isNone(current) || !sameRegistration(current.value, info)) return

      yield* signal(info.pid, "SIGTERM")
      const stopped = yield* awaitStopped(info.pid).pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.option,
      )
      if (Option.isSome(stopped)) return

      const latest = yield* healthy().pipe(Effect.option)
      if (Option.isNone(latest) || !sameRegistration(latest.value, info)) return
      yield* signal(info.pid, "SIGKILL")
      yield* awaitStopped(info.pid).pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
      )
    })

    const start = Effect.fn("cli.daemon.start")(function* () {
      const existing = yield* healthy().pipe(Effect.option)
      const found = Option.getOrUndefined(existing)
      const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
      if (found?.version === InstallationVersion) return found.url
      if (found) yield* stopProcess(found).pipe(Effect.ignore)

      const entrypoint = compiled ? undefined : process.argv[1]
      if (!compiled && entrypoint === undefined)
        return yield* Effect.fail(new Error("Failed to resolve CLI entrypoint"))
      yield* Effect.try({
        try: () => {
          spawn(process.execPath, [...(entrypoint ? [entrypoint] : []), "serve", "--service"], {
            detached: true,
            stdio: "ignore",
          }).unref()
        },
        catch: (cause) => new Error("Failed to start server", { cause }),
      })

      return yield* compatible().pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.map((info) => info.url),
        Effect.mapError(() => new Error("Failed to start server")),
      )
    })

    const transport = Effect.fn("cli.daemon.transport")(function* () {
      const current = yield* config()
      if (current.autostart === false) return yield* remoteTransport(current)
      return { url: yield* start(), headers: ServerAuth.headers({ password: yield* password() }) }
    })

    const client = Effect.fn("cli.daemon.client")(function* () {
      const connection = yield* transport()
      return createOpencodeClient({ baseUrl: connection.url, headers: connection.headers })
    })

    const status = Effect.fn("cli.daemon.status")(function* () {
      const existing = yield* healthy().pipe(Effect.option)
      const found = Option.getOrUndefined(existing)
      if (found?.version === InstallationVersion) return found.url
      if (found) return undefined
      yield* fs.remove(file).pipe(Effect.ignore)
      return undefined
    })

    const stop = Effect.fn("cli.daemon.stop")(function* () {
      const existing = yield* healthy().pipe(Effect.option)
      // A stale registration may point at a PID that has since been reused by
      // another process. Only signal the PID after authenticating the server.
      if (Option.isNone(existing)) return yield* fs.remove(file).pipe(Effect.ignore)
      yield* stopProcess(existing.value)
      yield* fs.remove(file).pipe(Effect.ignore)
    })

    const register = Effect.fn("cli.daemon.register")(function* (address: HttpServer.Address) {
      const id = randomUUID()
      const temp = file + "." + id + ".tmp"
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.writeFileString(
        temp,
        JSON.stringify({ id, version: InstallationVersion, url: HttpServer.formatAddress(address), pid: process.pid }),
        { mode: 0o600 },
      )
      yield* fs.rename(temp, file)
      yield* registration().pipe(
        Effect.flatMap((info) => (info.id === id ? Effect.void : signal(process.pid, "SIGTERM"))),
        Effect.catch(() => signal(process.pid, "SIGTERM")),
        Effect.repeat(Schedule.spaced("10 seconds")),
        Effect.forkScoped,
      )
      yield* Effect.addFinalizer(() =>
        registration().pipe(
          Effect.flatMap((info) => (info.id === id ? fs.remove(file) : Effect.void)),
          Effect.ignore,
        ),
      )
    })

    return Service.of({ client, transport, start, status, stop, password, config, get, set, unset, register })
  }),
)

function serviceURL(config: ServiceConfig) {
  const hostname = config.hostname ?? "127.0.0.1"
  const result = new URL(`http://${hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}`)
  result.port = String(config.port ?? 4096)
  return result.toString()
}

export * as Daemon from "./daemon"
