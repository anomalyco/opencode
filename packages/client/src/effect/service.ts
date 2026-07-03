import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

// Find, start, and stop the local opencode background service.
//
// The service daemon advertises itself through a registration file in the
// user's state directory: url, pid, version, and the private password, with
// 0600 permissions. That file is the complete discovery contract — reading it
// is all a client needs to connect. The daemon's own configuration (port,
// persisted password) is CLI-owned and never read here.

export type Transport = {
  readonly url: string
  readonly headers?: RequestInit["headers"]
}

export type ServiceOptions = {
  // Absolute path to the service registration file. Defaults to
  // opencode/service.json in the XDG state directory.
  readonly file?: string
  // When set, discovery only returns a server reporting this exact version,
  // and start() replaces a healthy server whose version differs.
  readonly version?: string
  // Argv used to spawn the service. Defaults to ["opencode", "serve",
  // "--service"] resolved from PATH.
  readonly command?: ReadonlyArray<string>
}

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to start() is the caller's policy.
export const discover = Effect.fn("service.discover")(function* (options: ServiceOptions = {}) {
  const registration = yield* read(options.file)
  if (registration === undefined) return undefined
  if (options.version !== undefined && registration.version !== options.version) return undefined
  const found = yield* probe(registration)
  return found?.transport
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns the service command detached.
export const start = Effect.fn("service.start")(function* (options: ServiceOptions = {}) {
  const compatible = yield* discover(options)
  if (compatible !== undefined) return compatible
  const mismatched = yield* find(options)
  if (mismatched !== undefined) yield* kill(mismatched.registration, options).pipe(Effect.ignore)

  const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
  if (command === undefined) return yield* Effect.fail(new Error("Missing service command"))
  yield* Effect.try({
    try: () => {
      spawn(command, args, { detached: true, stdio: "ignore" }).unref()
    },
    catch: (cause) => new Error("Failed to start server", { cause }),
  })

  return yield* discover(options).pipe(
    Effect.flatMap((found) =>
      found === undefined ? Effect.fail(new Error("Server is not ready")) : Effect.succeed(found),
    ),
    Effect.retry(poll),
    Effect.mapError(() => new Error("Failed to start server")),
  )
})

export const stop = Effect.fn("service.stop")(function* (options: ServiceOptions = {}) {
  const fs = yield* FileSystem.FileSystem
  const existing = yield* find(options)
  if (existing !== undefined) yield* kill(existing.registration, options)
  yield* fs.remove(options.file ?? fallback()).pipe(Effect.ignore)
})

function fallback() {
  const state = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

function auth(password: string): RequestInit["headers"] {
  return { authorization: "Basic " + btoa("opencode:" + password) }
}

const Registration = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.optional(Schema.String),
})
type Registration = typeof Registration.Type

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Registration))

// A missing or corrupt file means no valid registration; callers treat both
// the same (the registering server self-evicts, clients rediscover).
const read = Effect.fnUntraced(function* (file?: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file ?? fallback()).pipe(Effect.option)
  if (Option.isNone(text)) return undefined
  return yield* decode(text.value).pipe(Effect.option, Effect.map(Option.getOrUndefined))
})

type LocalService = {
  readonly registration: Registration
  readonly transport: Transport
}

const probe = Effect.fnUntraced(function* (registration: Registration) {
  const headers = registration.password === undefined ? undefined : auth(registration.password)
  const healthy = yield* Effect.tryPromise(() =>
    fetch(new URL("/api/health", registration.url), {
      headers,
      signal: AbortSignal.timeout(2_000),
    }),
  ).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  )
  if (!healthy) return undefined
  return { registration, transport: { url: registration.url, headers } } satisfies LocalService
})

// Health-checked lookup without the version gate: lifecycle operations must be
// able to see (and replace or stop) a server from a different version.
const find = Effect.fnUntraced(function* (options: ServiceOptions) {
  const registration = yield* read(options.file)
  if (registration === undefined) return undefined
  return yield* probe(registration)
})

// 50ms cadence bounded at ~5s, shared by stop escalation and start readiness.
const poll = Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(100)))

const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.try({ try: () => process.kill(pid, name), catch: (cause) => cause }).pipe(Effect.ignore)

const stopped = Effect.fnUntraced(function* (pid: number) {
  const running = yield* Effect.try({ try: () => process.kill(pid, 0), catch: () => false }).pipe(
    Effect.orElseSucceed(() => false),
  )
  if (!running) return true
  return yield* Effect.fail(new Error(`Server process ${pid} is still running`))
})

function same(left: Registration, right: Registration) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

const kill = Effect.fnUntraced(function* (info: Registration, options: ServiceOptions) {
  // A stale registration may point at a PID that has since been reused by
  // another process. Only signal the PID after authenticating the server.
  const current = yield* find(options)
  if (current === undefined || !same(current.registration, info)) return

  yield* signal(info.pid, "SIGTERM")
  const done = yield* stopped(info.pid).pipe(Effect.retry(poll), Effect.option)
  if (Option.isSome(done)) return

  const latest = yield* find(options)
  if (latest === undefined || !same(latest.registration, info)) return
  yield* signal(info.pid, "SIGKILL")
  yield* stopped(info.pid).pipe(Effect.retry(poll))
})

export * as Service from "./service.js"
