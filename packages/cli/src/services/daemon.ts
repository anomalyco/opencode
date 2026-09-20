import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Context, Effect, FileSystem, Layer, Option, Schedule, Schema, Scope } from "effect"
import { HttpServer } from "effect/unstable/http"
import { randomBytes, randomUUID } from "crypto"
import { spawn } from "node:child_process"
import path from "path"

export class Corrupt extends Schema.TaggedErrorClass<Corrupt>()("Daemon.Corrupt", {
  details: Schema.String,
}) {
  override get message() {
    return `Service registration is corrupt (${this.details}); not signaling any process`
  }
}

export class Unreachable extends Schema.TaggedErrorClass<Unreachable>()("Daemon.Unreachable", {
  pid: Schema.Int,
  url: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Registered server at ${this.url} (pid ${this.pid}) did not answer health (${this.reason}); not signaling the process. Retry once it is reachable, or stop it from the same machine if you own it.`
  }
}

export class Rejected extends Schema.TaggedErrorClass<Rejected>()("Daemon.Rejected", {
  pid: Schema.Int,
  signal: Schema.String,
}) {
  override get message() {
    return `Could not send ${this.signal} to process ${this.pid}: permission denied`
  }
}

export class StopTimeout extends Schema.TaggedErrorClass<StopTimeout>()("Daemon.Timeout", {
  pid: Schema.Int,
}) {
  override get message() {
    return `Server process ${this.pid} did not exit`
  }
}

export class NotReplaced extends Schema.TaggedErrorClass<NotReplaced>()("Daemon.NotReplaced", {
  pid: Schema.Int,
  id: Schema.optional(Schema.String),
}) {
  override get message() {
    return `Service restart reused instance ${this.id ?? this.pid}`
  }
}

export interface Interface {
  readonly client: () => Effect.Effect<ReturnType<typeof createOpencodeClient>, unknown>
  readonly transport: () => Effect.Effect<{ url: string; headers: RequestInit["headers"] }, unknown>
  readonly start: () => Effect.Effect<string, Error>
  readonly restart: () => Effect.Effect<string, Error>
  readonly status: () => Effect.Effect<string | undefined>
  readonly stop: () => Effect.Effect<void, Error>
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

type Probe =
  | { readonly _tag: "missing" }
  | { readonly _tag: "corrupt"; readonly details: string }
  | { readonly _tag: "stale"; readonly info: Registration }
  | { readonly _tag: "unreachable"; readonly info: Registration; readonly reason: string }
  | { readonly _tag: "healthy"; readonly info: Registration }

function killCode(cause: unknown) {
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code)
}

function healthReason(cause: unknown) {
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) return "timeout"
  return "network"
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const directory = global.state
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

    const alive = (pid: number) =>
      Effect.try({
        try: () => {
          process.kill(pid, 0)
          return true
        },
        catch: (cause) => cause,
      }).pipe(Effect.catch((cause) => Effect.succeed(killCode(cause) !== "ESRCH")))

    const probe = Effect.fnUntraced(function* () {
      if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return { _tag: "missing" as const }

      const decoded = yield* fs.readFileString(file).pipe(Effect.flatMap(decodeRegistration), Effect.option)
      if (Option.isNone(decoded)) return { _tag: "corrupt" as const, details: "invalid JSON" }
      const info = decoded.value
      if (!(yield* alive(info.pid))) return { _tag: "stale" as const, info }

      const secret = yield* password().pipe(Effect.option)
      if (Option.isNone(secret)) return { _tag: "unreachable" as const, info, reason: "unauthorized" }
      const client = createOpencodeClient({
        baseUrl: info.url,
        headers: ServerAuth.headers({ password: secret.value }),
      })
      return yield* Effect.tryPromise({
        try: () => client.v2.health.get({ signal: AbortSignal.timeout(2_000) }),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((response) =>
          response.data?.healthy === true
            ? { _tag: "healthy" as const, info }
            : { _tag: "unreachable" as const, info, reason: "unhealthy" },
        ),
        Effect.catch((cause) =>
          Effect.succeed({ _tag: "unreachable" as const, info, reason: healthReason(cause) }),
        ),
      )
    })

    const signal = (pid: number, name: NodeJS.Signals) =>
      Effect.try({
        try: () => process.kill(pid, name),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) => {
          const code = killCode(cause)
          if (code === "ESRCH") return Effect.void
          if (code === "EPERM") return new Rejected({ pid, signal: name })
          return Effect.fail(cause instanceof Error ? cause : new Error(String(cause)))
        }),
      )

    const awaitStopped = Effect.fnUntraced(function* (pid: number) {
      if (!(yield* alive(pid))) return true
      return yield* Effect.fail(new Error(`Server process ${pid} is still running`))
    })

    const stopProcess = Effect.fnUntraced(function* (info: Registration) {
      yield* Effect.log(`daemon stop accepted: pid ${info.pid}`)
      yield* signal(info.pid, "SIGTERM")
      const stopped = yield* awaitStopped(info.pid).pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.option,
      )
      if (Option.isSome(stopped)) return
      if (!(yield* alive(info.pid))) return

      const latest = yield* probe()
      if (latest._tag !== "healthy" || !sameRegistration(latest.info, info)) {
        return yield* new StopTimeout({ pid: info.pid })
      }
      yield* Effect.log(`daemon stop escalated: pid ${info.pid}`)
      yield* signal(info.pid, "SIGKILL")
      yield* awaitStopped(info.pid).pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.mapError(() => new StopTimeout({ pid: info.pid })),
      )
    })

    const clear = () => fs.remove(file).pipe(Effect.ignore)

    const start = Effect.fn("cli.daemon.start")(function* () {
      const existing = yield* probe()
      const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
      if (existing._tag === "healthy" && existing.info.version === InstallationVersion && compiled) {
        yield* Effect.log(`daemon start reused: pid ${existing.info.pid}`)
        return existing.info.url
      }
      if (existing._tag === "healthy") {
        yield* stopProcess(existing.info)
        yield* clear()
      }
      if (existing._tag === "unreachable") {
        return yield* new Unreachable({
          pid: existing.info.pid,
          url: existing.info.url,
          reason: existing.reason,
        })
      }
      if (existing._tag === "corrupt") return yield* new Corrupt({ details: existing.details })
      if (existing._tag === "stale") yield* clear()

      const entrypoint = compiled ? undefined : process.argv[1]
      if (!compiled && entrypoint === undefined)
        return yield* Effect.fail(new Error("Failed to resolve CLI entrypoint"))
      yield* Effect.log("daemon start spawned")
      yield* Effect.try({
        try: () => {
          spawn(process.execPath, [...(entrypoint ? [entrypoint] : []), "serve", "--register"], {
            detached: true,
            stdio: "ignore",
          }).unref()
        },
        catch: (cause) => new Error("Failed to start server", { cause }),
      })

      const compatible = Effect.fnUntraced(function* () {
        const current = yield* probe()
        if (current._tag === "healthy" && current.info.version === InstallationVersion) return current.info.url
        return yield* Effect.fail(new Error("Failed to start server"))
      })
      return yield* compatible().pipe(
        Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))),
        Effect.mapError(() => new Error("Failed to start server")),
      )
    })

    const transport = Effect.fn("cli.daemon.transport")(function* () {
      return { url: yield* start(), headers: ServerAuth.headers({ password: yield* password() }) }
    })

    const client = Effect.fn("cli.daemon.client")(function* () {
      const connection = yield* transport()
      return createOpencodeClient({ baseUrl: connection.url, headers: connection.headers })
    })

    const status = Effect.fn("cli.daemon.status")(function* () {
      const current = yield* probe()
      if (current._tag === "healthy" && current.info.version === InstallationVersion) return current.info.url
      if (current._tag === "stale") yield* clear()
      return undefined
    })

    const stopFrom = Effect.fnUntraced(function* (current: Probe) {
      if (current._tag === "missing") {
        yield* Effect.log("daemon stop skipped: no registration")
        return
      }
      if (current._tag === "stale") {
        yield* Effect.log(`daemon stop skipped: stale pid ${current.info.pid}`)
        yield* clear()
        return
      }
      if (current._tag === "corrupt") return yield* new Corrupt({ details: current.details })
      if (current._tag === "unreachable") {
        return yield* new Unreachable({
          pid: current.info.pid,
          url: current.info.url,
          reason: current.reason,
        })
      }

      // A stale registration may point at a PID that has since been reused by
      // another process. Only signal the PID after authenticating the server.
      yield* stopProcess(current.info)
      yield* clear()
    })

    const stop = Effect.fn("cli.daemon.stop")(function* () {
      yield* stopFrom(yield* probe())
    })

    const restart = Effect.fn("cli.daemon.restart")(function* () {
      const previous = yield* probe()
      yield* stopFrom(previous)
      const url = yield* start()
      if (previous._tag !== "healthy") return url
      const next = yield* probe()
      if (next._tag === "healthy" && next.info.pid === previous.info.pid && next.info.id === previous.info.id) {
        return yield* new NotReplaced({ pid: next.info.pid, id: next.info.id })
      }
      return url
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
      yield* Effect.log(`daemon register elected ${id}`)
      const lose = Effect.log(`daemon register lost election ${id}`).pipe(Effect.andThen(signal(process.pid, "SIGTERM")))
      const watch = Effect.fnUntraced(function* () {
        const info = yield* fs.readFileString(file).pipe(Effect.flatMap(decodeRegistration))
        if (info.id === id) return
        yield* lose
      })
      yield* watch().pipe(
        Effect.catch(() => lose),
        Effect.repeat(Schedule.spaced("10 seconds")),
        Effect.forkScoped,
      )
      yield* Effect.addFinalizer(() =>
        fs.readFileString(file).pipe(
          Effect.flatMap(decodeRegistration),
          Effect.flatMap((info) => (info.id === id ? fs.remove(file) : Effect.void)),
          Effect.ignore,
        ),
      )
    })

    return Service.of({ client, transport, start, restart, status, stop, password, register })
  }),
)

export * as Daemon from "./daemon"
