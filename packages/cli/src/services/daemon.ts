import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Context, Effect, FileSystem, Layer, Option, Schedule, Schema, Scope } from "effect"
import { HttpServer } from "effect/unstable/http"
import { randomBytes, randomUUID } from "crypto"
import path from "path"

export interface Interface {
  readonly client: () => Effect.Effect<ReturnType<typeof createOpencodeClient>, unknown>
  readonly start: () => Effect.Effect<string, Error>
  readonly status: () => Effect.Effect<string | undefined>
  readonly stop: () => Effect.Effect<void, unknown>
  readonly password: (value?: string) => Effect.Effect<string, unknown>
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

function sameRegistration(left: Registration, right: Registration) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = Global.Path.state
    const file = path.join(directory, "server.json")
    const passwordFile = path.join(directory, "password")
    const decodeRegistration = Schema.decodeUnknownEffect(Schema.fromJsonString(Registration))

    const password = Effect.fn("cli.daemon.password")(function* (value?: string) {
      const existing = yield* fs.readFileString(passwordFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (value === undefined && existing) return existing

      // Keep one private credential across server restarts so discovered clients
      // can reconnect without exposing a password flag or environment variable.
      const generated = value ?? randomBytes(32).toString("base64url")
      const temp = passwordFile + ".tmp"
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.writeFileString(temp, generated, { mode: 0o600 })
      yield* fs.rename(temp, passwordFile)
      return generated
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
      if (found?.version === InstallationVersion) return found.url
      if (found) yield* stopProcess(found).pipe(Effect.ignore)

      yield* Effect.sync(() => {
        const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
        Bun.spawn([process.execPath, ...(compiled ? [] : [Bun.main]), "serve", "--register"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }).unref()
      })

      return yield* compatible().pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.map((info) => info.url),
        Effect.mapError(() => new Error("Failed to start server")),
      )
    })

    const client = Effect.fn("cli.daemon.client")(function* () {
      return yield* createClient(yield* start())
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

    return Service.of({ client, start, status, stop, password, register })
  }),
)

export const defaultLayer = layer

export * as Daemon from "./daemon"
