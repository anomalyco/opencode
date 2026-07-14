import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
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
  readonly onStatus?: (status: Status) => void
}

export type Status =
  | { readonly type: "missing" }
  | { readonly type: "unreachable" }
  | { readonly type: "unresponsive" }
  | (ServiceStatus.State & { readonly version?: string })

export class FailedError extends Schema.TaggedErrorClass<FailedError>()("ServiceFailedError", {
  message: Schema.String,
  action: Schema.String,
}) {}

type Contender = {
  readonly child: ChildProcess
  readonly error: () => Error | undefined
}

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to start() is the caller's policy.
export const discover = Effect.fn("service.discover")(function* (options: Options = {}) {
  return (yield* discoverLocal(options))?.endpoint
})

export const status = Effect.fn("service.status")(function* (options: Options = {}) {
  const result = yield* registered(options.file, true)
  if (result.info === undefined) return { type: "missing" } satisfies Status
  if (result.service === undefined) return { type: "unreachable" } satisfies Status
  return publicStatus(result.service)
})

function publicStatus(service: LocalService): Status {
  return { ...service.status, version: service.version }
}

const discoverLocal = Effect.fnUntraced(function* (options: Options) {
  const found = (yield* registered(options.file)).service
  if (found?.status.type !== "ready") return undefined
  if (options.version !== undefined && found.version !== options.version) return undefined
  return found
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
export const start = Effect.fn("service.start")(function* (options: StartOptions = {}) {
  const contenders = new Set<Contender>()
  let announced = false
  let reported: Status | undefined
  let lastSpawn = 0
  let spawnDelay = 5_000
  let ownerHeld = false
  const announce = (reason: StartReason, existing?: Info) =>
    Effect.sync(() => {
      if (announced) return
      announced = true
      options.onStart?.(reason, existing)
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
    const current: Status =
      service === undefined ? { type: info === undefined ? "missing" : "unreachable" } : publicStatus(service)
    const next = ownerHeld && service === undefined ? ({ type: "unresponsive" } satisfies Status) : current
    yield* Effect.sync(() => {
      if (sameStatus(reported, next)) return
      reported = next
      options.onStatus?.(next)
    })
    if (service !== undefined) {
      ownerHeld = false
      spawnDelay = 5_000
      const compatible = !service.legacy && (options.version === undefined || service.version === options.version)
      if (compatible && service.status.type === "ready") return Option.some(service)
      if (compatible && service.status.type === "failed")
        return yield* new FailedError({ message: service.status.message, action: service.status.action })
      if (compatible || service.status.type === "stopping") return Option.none<LocalService>()
      yield* announce("version-mismatch", service.info)
      yield* kill(service, options, options.version).pipe(Effect.ignore)
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
  }).pipe(Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("1 second") }))
  return Option.getOrThrow(found).endpoint
})

function sameStatus(left: Status | undefined, right: Status) {
  if (left?.type !== right.type) return false
  if (right.type === "failed")
    return (
      left.type === "failed" &&
      left.version === right.version &&
      left.message === right.message &&
      left.action === right.action
    )
  if (right.type === "stopping")
    return left.type === "stopping" && left.version === right.version && left.targetVersion === right.targetVersion
  if (right.type === "starting" || right.type === "ready")
    return left.type === right.type && left.version === right.version
  return true
}

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

export type StopMetadata = {
  readonly targetVersion?: string
}

export const stop = Effect.fn("service.stop")(function* (options: Options = {}, metadata: StopMetadata = {}) {
  const existing = yield* find(options)
  if (existing !== undefined) yield* kill(existing, options, metadata.targetVersion)
})

function fallback() {
  const state = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

export function headers(endpoint: Endpoint) {
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
  readonly status: ServiceStatus.State
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
    if (info.id !== undefined && health.value.instanceID !== undefined && health.value.instanceID !== info.id)
      return undefined
    return {
      info,
      endpoint,
      version: health.value.version,
      status: health.value.status,
      legacy: false,
    } satisfies LocalService
  }
  if (
    !allowLegacy ||
    Option.isNone(decodeLegacyHealth(body)) ||
    (typeof body === "object" && body !== null && ("version" in body || "pid" in body))
  )
    return undefined
  return { info, endpoint, status: { type: "ready" }, legacy: true } satisfies LocalService
})

const registered = Effect.fnUntraced(function* (file?: string, allowLegacy = false) {
  const info = yield* read(file)
  if (info === undefined) return { info: undefined, service: undefined }
  return { info, service: yield* probe(info, allowLegacy) }
})

// Health-checked lookup without the version gate: status operations must be
// able to see (and replace or stop) a server from a different version.
const find = Effect.fnUntraced(function* (options: Options) {
  return (yield* registered(options.file, true)).service
})

// 50ms cadence bounded at ~5s, shared by stop escalation and each start
// discovery window.
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

const kill = Effect.fnUntraced(function* (service: LocalService, options: Options, targetVersion?: string) {
  const requested = yield* requestStop(service, targetVersion)
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

const requestStop = Effect.fnUntraced(function* (service: LocalService, targetVersion?: string) {
  if (service.info.id === undefined || service.legacy) return "unsupported" as const
  const response = yield* Effect.tryPromise(() =>
    fetch(new URL("/api/service/stop", service.info.url), {
      method: "POST",
      headers: { ...headers(service.endpoint), "content-type": "application/json" },
      body: JSON.stringify({ instanceID: service.info.id, targetVersion }),
      signal: AbortSignal.timeout(2_000),
    }),
  ).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  if (response === undefined || response.status === 404 || response.status === 405) return "unsupported" as const
  const body = yield* Effect.tryPromise(() => response.json()).pipe(Effect.option, Effect.map(Option.getOrUndefined))
  const decoded = decodeStopResponse(body)
  if (!response.ok || Option.isNone(decoded) || !decoded.value.accepted) return "rejected" as const
  return "accepted" as const
})

export * as Service from "./service.js"
