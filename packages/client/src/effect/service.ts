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

export type Endpoint = {
  readonly url: string
  readonly auth?: {
    readonly type: "basic"
    readonly username: string
    readonly password: string
  }
}

export type Options = {
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

export type StartReason = "missing" | "version-mismatch"

export type StartOptions = Options & {
  // Called once when start() decides it must spawn: either no service was
  // found, or a healthy service with a different version is being replaced.
  // `existing` carries the registration of the service being replaced.
  readonly onStart?: (reason: StartReason, existing?: Info) => void
}

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to start() is the caller's policy.
export const discover = Effect.fn("service.discover")(function* (options: Options = {}) {
  return (yield* discoverLocal(options))?.endpoint
})

const discoverLocal = Effect.fnUntraced(function* (options: Options) {
  const info = yield* read(options.file)
  if (info === undefined) return undefined
  if (options.version !== undefined && info.version !== options.version) return undefined
  return yield* probe(info, options.version)
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns the service command detached.
export const start = Effect.fn("service.start")(function* (options: StartOptions = {}) {
  const compatible = yield* discover(options)
  if (compatible !== undefined) return compatible
  const existing = yield* find(options)
  if (existing?.version !== undefined && (options.version === undefined || existing.version === options.version))
    return existing.endpoint
  yield* Effect.sync(() => options.onStart?.(existing === undefined ? "missing" : "version-mismatch", existing?.info))
  if (existing !== undefined) yield* kill(existing.info, options).pipe(Effect.ignore)

  const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
  if (command === undefined) return yield* Effect.fail(new Error("Missing service command"))
  const child = yield* Effect.try({
    try: () => {
      const child = spawn(command, args, { detached: true, stdio: "ignore" })
      child.unref()
      return child
    },
    catch: (cause) => new Error("Failed to start server", { cause }),
  })

  return yield* discoverLocal(options).pipe(
    Effect.flatMap((found) =>
      found === undefined ? Effect.fail(new Error("Server is not ready")) : Effect.succeed(found),
    ),
    Effect.retry(poll),
    Effect.tap((found) =>
      found.info.pid === child.pid
        ? Effect.void
        : Effect.sync(() => {
            child.kill("SIGTERM")
          }),
    ),
    Effect.map((found) => found.endpoint),
    Effect.tapError(() => Effect.try({ try: () => child.kill("SIGTERM"), catch: () => undefined }).pipe(Effect.ignore)),
    Effect.mapError(() => new Error("Failed to start server")),
  )
})

export const stop = Effect.fn("service.stop")(function* (options: Options = {}) {
  const fs = yield* FileSystem.FileSystem
  const existing = yield* find(options)
  if (existing !== undefined) yield* kill(existing.info, options)
  yield* fs.remove(options.file ?? fallback()).pipe(Effect.ignore)
})

function fallback() {
  const state = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

export function headers(endpoint: Endpoint): RequestInit["headers"] {
  if (endpoint.auth === undefined) return undefined
  return { authorization: "Basic " + btoa(endpoint.auth.username + ":" + endpoint.auth.password) }
}

export const Info = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.optional(Schema.String),
})
export type Info = typeof Info.Type

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))
const decodeHealth = Schema.decodeUnknownOption(
  Schema.Struct({ healthy: Schema.Literal(true), version: Schema.String, pid: Schema.Int }),
)
const decodeLegacyHealth = Schema.decodeUnknownOption(Schema.Struct({ healthy: Schema.Literal(true) }))

// A missing or corrupt file means no valid info; callers treat both
// the same (the registering server self-evicts, clients rediscover).
const read = Effect.fnUntraced(function* (file?: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file ?? fallback()).pipe(Effect.option)
  if (Option.isNone(text)) return undefined
  return yield* decode(text.value).pipe(Effect.option, Effect.map(Option.getOrUndefined))
})

type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
}

const probe = Effect.fnUntraced(function* (info: Info, version?: string, allowLegacy = false) {
  const endpoint = {
    url: info.url,
    auth:
      info.password === undefined
        ? undefined
        : { type: "basic" as const, username: "opencode", password: info.password },
  } satisfies Endpoint
  const response = yield* Effect.tryPromise(() =>
    fetch(new URL("/api/health", info.url), {
      headers: headers(endpoint),
      signal: AbortSignal.timeout(2_000),
    }),
  ).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  if (response === undefined || !response.ok) return undefined
  const body = yield* Effect.tryPromise(() => response.json()).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  const health = decodeHealth(body)
  if (Option.isSome(health)) {
    if (health.value.pid !== info.pid) return undefined
    if (info.version !== undefined && health.value.version !== info.version) return undefined
    if (version !== undefined && health.value.version !== version) return undefined
    return { info, endpoint, version: health.value.version } satisfies LocalService
  }
  if (
    !allowLegacy ||
    Option.isNone(decodeLegacyHealth(body)) ||
    (typeof body === "object" && body !== null && ("version" in body || "pid" in body))
  )
    return undefined
  return { info, endpoint } satisfies LocalService
})

// Health-checked lookup without the version gate: lifecycle operations must be
// able to see (and replace or stop) a server from a different version.
const find = Effect.fnUntraced(function* (options: Options) {
  const info = yield* read(options.file)
  if (info === undefined) return undefined
  return yield* probe(info, undefined, true)
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

function same(left: Info, right: Info) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

const kill = Effect.fnUntraced(function* (info: Info, options: Options) {
  // A stale registration may point at a PID that has since been reused by
  // another process. Only signal the PID after authenticating the server.
  const current = yield* find(options)
  if (current === undefined || !same(current.info, info)) return

  yield* signal(info.pid, "SIGTERM")
  const done = yield* stopped(info.pid).pipe(Effect.retry(poll), Effect.option)
  if (Option.isSome(done)) return

  const latest = yield* find(options)
  if (latest === undefined || !same(latest.info, info)) return
  yield* signal(info.pid, "SIGKILL")
  yield* stopped(info.pid).pipe(Effect.retry(poll))
})

export * as Service from "./service.js"
