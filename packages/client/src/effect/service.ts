import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, EnsureOptions, StopOptions } from "../service.js"

export * from "../service.js"
/** Contents of the local service registration file. */
export type Info = import("../service.js").Info

// Find, start, and stop the local opencode background service.
//
// The service daemon advertises itself through a registration file in the
// user's state directory: url, pid, version, and the private password, with
// 0600 permissions. That file is the complete discovery contract — reading it
// is all a client needs to connect. The daemon's own configuration (port,
// persisted password) is CLI-owned and never read here.

type Contender = {
  readonly child: ChildProcess
  readonly error: () => Error | undefined
}

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to ensure() is the caller's policy.
/** Discover a healthy, compatible local service without starting one. */
export const discover = Effect.fn("service.discover")(function* (options: DiscoverOptions = {}) {
  return (yield* discoverLocal(options))?.endpoint
})

/** Recognize an authenticated compatible service bound to an expected URL, including while it starts or fails. */
export const incumbent = Effect.fn("service.incumbent")(function* (
  options: DiscoverOptions & { readonly url: string },
) {
  const info = yield* read(options.file)
  const found = info === undefined ? undefined : yield* probe({ ...info, url: options.url })
  if (found === undefined || found.legacy) return undefined
  if (options.version !== undefined && found.version !== options.version) return undefined
  return { endpoint: found.endpoint, state: found.state }
})

const discoverLocal = Effect.fnUntraced(function* (options: DiscoverOptions) {
  const found = (yield* registered(options.file)).service
  if (found?.state !== "ready") return undefined
  if (options.version !== undefined && found.version !== options.version) return undefined
  return found
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
/** Ensure a healthy, compatible local service is running. */
export const ensure = Effect.fn("service.ensure")(function* (options: EnsureOptions = {}) {
  const contenders = new Set<Contender>()
  let announced = false
  let lastSpawn = 0
  let spawnDelay = 5_000
  let ownerHeld = false
  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) =>
    Effect.sync(() => {
      if (announced) return
      announced = true
      options.onStart?.(reason, previousVersion)
    })
  const spawnContender = Effect.gen(function* () {
    const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
    if (command === undefined) return yield* Effect.fail(new Error("Missing service command"))
    return yield* Effect.try({
      try: () => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" })
        let error: Error | undefined
        child.once("error", (cause) => {
          error = new Error("Failed to start server", { cause })
        })
        child.unref()
        return { child, error: () => error }
      },
      catch: (cause) => new Error("Failed to start server", { cause }),
    })
  })
  const found = yield* Effect.gen(function* () {
    const registration = yield* registered(options.file, true)
    const info = registration.info
    const service = registration.service
    if (service !== undefined) {
      ownerHeld = false
      spawnDelay = 5_000
      const compatible = !service.legacy && (options.version === undefined || service.version === options.version)
      if (compatible && service.state === "ready") return Option.some(service)
      if (compatible && service.state === "failed")
        return yield* Effect.fail(new Error("Background service failed to start"))
      if (compatible) return Option.none<LocalService>()
      yield* announce("version-mismatch", service.version)
      yield* kill(service, options).pipe(Effect.ignore)
      lastSpawn = 0
      return Option.none<LocalService>()
    } else if (lastSpawn === 0 && info !== undefined) lastSpawn = Date.now()

    const failure = [...contenders].map(contenderFailure).find((error): error is Error => error !== undefined)
    if (failure !== undefined) return yield* Effect.fail(failure)
    const finished = [...contenders].filter(contenderFinished)
    if (finished.some((item) => item.child.exitCode === 0)) {
      ownerHeld = true
      spawnDelay = Math.min(spawnDelay * 2, 30_000)
    }
    finished.forEach((item) => contenders.delete(item))
    // Keep one candidate plus one lock probe so a pre-lock stall cannot block recovery.
    if (contenders.size < 2 && Date.now() - lastSpawn >= spawnDelay) {
      yield* announce("missing")
      contenders.add(yield* spawnContender)
      lastSpawn = Date.now()
    }
    return Option.none<LocalService>()
  }).pipe(
    Effect.repeat({
      until: Option.isSome,
      schedule: Schedule.max([Schedule.spaced("1 second"), Schedule.recurs(120)]),
    }),
  )
  if (Option.isNone(found))
    return yield* Effect.fail(new Error("Timed out waiting for the background service to start"))
  return found.value.endpoint
})

function contenderFailure(contender: Contender) {
  const error = contender.error()
  if (error !== undefined) return error
  if (contender.child.exitCode !== null && contender.child.exitCode !== 0)
    return new Error(`Server process exited with code ${contender.child.exitCode}`)
  if (contender.child.signalCode !== null)
    return new Error(`Server process terminated by ${contender.child.signalCode}`)
  return undefined
}

function contenderFinished(contender: Contender) {
  return contender.error() !== undefined || contender.child.exitCode !== null || contender.child.signalCode !== null
}

/** Stop the registered local service. */
export const stop = Effect.fn("service.stop")(function* (options: StopOptions = {}) {
  const existing = yield* find(options)
  if (existing !== undefined) yield* kill(existing, options)
})

function fallback() {
  const state = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

/** Create HTTP authentication headers for a service endpoint. */
export function headers(endpoint: Endpoint) {
  if (endpoint.auth === undefined) return undefined
  return { authorization: "Basic " + btoa(endpoint.auth.username + ":" + endpoint.auth.password) }
}

/** Schema for the local service registration file. */
export const Info = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.optional(Schema.String),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))
const decodeHealth = Schema.decodeUnknownOption(ServiceStatus.Health)
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
  readonly state: "ready" | "waiting" | "failed"
  readonly legacy: boolean
}

const probe = Effect.fnUntraced(function* (info: Info, allowLegacy = false) {
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
  if (response === undefined) return undefined
  const body = yield* Effect.tryPromise(() => response.json()).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  const health = decodeHealth(body)
  if (Option.isSome(health)) {
    if (health.value.pid !== info.pid) return undefined
    if (info.version !== undefined && health.value.version !== info.version) return undefined
    return {
      info,
      endpoint,
      version: health.value.version,
      state: response.ok ? "ready" : response.status === 500 ? "failed" : "waiting",
      legacy: false,
    } satisfies LocalService
  }
  if (
    !allowLegacy ||
    Option.isNone(decodeLegacyHealth(body)) ||
    (typeof body === "object" && body !== null && ("version" in body || "pid" in body))
  )
    return undefined
  return { info, endpoint, state: "ready", legacy: true } satisfies LocalService
})

const registered = Effect.fnUntraced(function* (file?: string, allowLegacy = false) {
  const info = yield* read(file)
  if (info === undefined) return { info: undefined, service: undefined }
  return { info, service: yield* probe(info, allowLegacy) }
})

// Health-checked lookup without the version gate: lifecycle operations must be
// able to see (and replace or stop) a server from a different version.
const find = Effect.fnUntraced(function* (options: { readonly file?: string }) {
  return (yield* registered(options.file, true)).service
})

// 50ms cadence bounded at ~5s, shared by stop escalation and each ensure
// discovery window.
const poll = Schedule.max([Schedule.spaced("50 millis"), Schedule.recurs(100)])

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

const kill = Effect.fnUntraced(function* (service: LocalService, options: { readonly file?: string }) {
  const requested = yield* requestStop(service)
  if (requested === "rejected") return
  if (requested === "unsupported") {
    // A stale registration may point at a reused PID. Authenticate again
    // immediately before the legacy signal fallback.
    const current = yield* find(options)
    if (current === undefined || !same(current.info, service.info)) return
    yield* signal(service.info.pid, "SIGTERM")
  }
  const done = yield* stopped(service.info.pid).pipe(Effect.retry(poll), Effect.option)
  if (Option.isSome(done)) return

  const latest = yield* find(options)
  if (latest === undefined || !same(latest.info, service.info)) return
  yield* signal(service.info.pid, "SIGKILL")
  yield* stopped(service.info.pid).pipe(Effect.retry(poll))
})

const decodeStopResponse = Schema.decodeUnknownOption(ServiceStatus.StopResponse)

const requestStop = Effect.fnUntraced(function* (service: LocalService) {
  if (service.info.id === undefined || service.legacy) return "unsupported" as const
  const response = yield* Effect.tryPromise(() =>
    fetch(new URL("/api/service/stop", service.info.url), {
      method: "POST",
      headers: { ...headers(service.endpoint), "content-type": "application/json" },
      body: JSON.stringify({ instanceID: service.info.id }),
      signal: AbortSignal.timeout(2_000),
    }),
  ).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  if (response === undefined || response.status === 404 || response.status === 405) return "unsupported" as const
  const body = yield* Effect.tryPromise(() => response.json()).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  const decoded = decodeStopResponse(body)
  if (!response.ok || Option.isNone(decoded) || !decoded.value.accepted) return "rejected" as const
  return "accepted" as const
})

/** Effect-based local service lifecycle operations. */
export const Service = { discover, incumbent, ensure, stop, headers, Info }
