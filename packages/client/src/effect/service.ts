import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, EnsureOptions, StopOptions } from "../service.js"
import {
  contenderFailure,
  contenderFinished,
  type ServiceContender,
  spawnServiceContender,
} from "../service-contender.js"
import { defaultEnsureTiming, ensureTiming, type EnsureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"

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

// Read-only lookup: registration file plus health check and version gate.
// Never spawns; escalation to ensure() is the caller's policy.
/** Discover a healthy, compatible local service without starting one. */
export const discover = Effect.fn("service.discover")(function* (options: DiscoverOptions = {}) {
  const found = (yield* registered(options.file)).service
  if (found?.state !== "ready") return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return found.endpoint
})

/** Recognize an authenticated compatible service bound to an expected URL, including while it starts or fails. */
export const incumbent = Effect.fn("service.incumbent")(function* (
  options: DiscoverOptions & { readonly url: string },
) {
  const info = yield* read(options.file)
  const found = info === undefined ? undefined : yield* probe({ ...info, url: options.url })
  if (found === undefined) return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return { endpoint: found.endpoint, state: found.state }
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
/** Ensure a healthy, compatible local service is running. */
export const ensure = Effect.fn("service.ensure")(function* (options: EnsureOptions = {}) {
  const timing = ensureTiming(options)
  const contenders = new Set<ServiceContender>()
  let timeouts: { readonly info: Info; readonly count: number } | undefined
  let announced = false
  let lastSpawn = 0
  let spawnDelay = timing.spawnDelay
  let failure: Error | undefined
  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) =>
    Effect.sync(() => {
      if (announced) return
      announced = true
      options.onStart?.(reason, previousVersion)
    })
  const spawnContender = Effect.gen(function* () {
    const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
    if (command === undefined) return yield* Effect.fail(new Error("Missing service command"))
    const env = yield* Effect.tryPromise(() => PtyHandoff.environment(options.file ?? fallback(), options.env))
    return yield* Effect.try({
      try: () => {
        return spawnServiceContender(command, args, env)
      },
      catch: (cause) => new Error("Failed to start server", { cause }),
    })
  })
  const found = yield* Effect.gen(function* () {
    const registration = yield* registered(options.file, timing.requestTimeout)
    const info = registration.info
    const service = registration.service
    if (registration.timedOut && info !== undefined) {
      timeouts = {
        info,
        count: timeouts !== undefined && same(timeouts.info, info) ? timeouts.count + 1 : 1,
      }
      if (timeouts.count >= 3) {
        yield* announce("missing")
        yield* Effect.logWarning("Background service is unresponsive; recovery cannot preserve persistent terminals")
        yield* Effect.tryPromise(() => PtyHandoff.clear(options.file ?? fallback()))
        yield* terminate(info, options, timing)
        timeouts = undefined
        lastSpawn = Date.now() - spawnDelay
      }
    } else timeouts = undefined
    if (service !== undefined) {
      spawnDelay = timing.spawnDelay
      const compatible = service.compatible && matchesVersion(service.version, options)
      if (compatible && service.state === "ready") {
        yield* Effect.tryPromise(() => PtyHandoff.complete(options.file ?? fallback(), service.info))
        return Option.some(service)
      }
      if (compatible && service.state === "failed")
        return yield* Effect.fail(new Error("Background service failed to start"))
      if (compatible) return Option.none<LocalService>()
      yield* announce("version-mismatch", service.version)
      if (service.state !== "ready")
        yield* Effect.logWarning("Background service is not ready; replacement cannot preserve persistent terminals")
      yield* stop({
        file: options.file,
        pty: service.state === "ready" ? "handoff" : "clear",
      }).pipe(Effect.ignore)
      lastSpawn = 0
      return Option.none<LocalService>()
    } else if (lastSpawn === 0 && info !== undefined) lastSpawn = Date.now()

    const finished = [...contenders].filter(contenderFinished)
    failure ??= finished.map(contenderFailure).find((error): error is Error => error !== undefined)
    if (finished.some((item) => item.child.exitCode === 0)) {
      spawnDelay = Math.min(spawnDelay * 2, timing.maxSpawnDelay)
    }
    finished.forEach((item) => contenders.delete(item))
    if (failure !== undefined && contenders.size === 0) return yield* Effect.fail(failure)
    // Keep one candidate plus one lock probe for pre-lock stalls. After a failure, let the
    // survivors finish without recruiting replacements that could hide the error indefinitely.
    if (failure === undefined && contenders.size < 2 && Date.now() - lastSpawn >= spawnDelay) {
      yield* announce("missing")
      contenders.add(yield* spawnContender)
      lastSpawn = Date.now()
    }
    return Option.none<LocalService>()
  }).pipe(
    Effect.repeat({
      until: Option.isSome,
      // Probes run sequentially, so a slow probe stretches each iteration; bound the loop by wall clock
      // like the Promise variant rather than by attempt count.
      schedule: Schedule.spaced(timing.pollInterval).pipe(Schedule.upTo({ duration: timing.promiseTimeout })),
    }),
    Effect.ensuring(Effect.sync(() => contenders.forEach((contender) => contender.release()))),
  )
  if (Option.isNone(found))
    return yield* Effect.fail(failure ?? new Error("Timed out waiting for the background service to start"))
  return found.value.endpoint
})

/** Stop the registered local service. */
export const stop = Effect.fn("service.stop")(function* (options: StopOptions = {}) {
  const info = yield* read(options.file)
  if (options.pty === "handoff" && info !== undefined)
    yield* Effect.tryPromise(() =>
      PtyHandoff.prepare(options.file ?? fallback(), info, defaultEnsureTiming.requestTimeout),
    )
  else yield* Effect.tryPromise(() => PtyHandoff.clear(options.file ?? fallback()))
  if (info !== undefined) yield* terminate(info, options, defaultEnsureTiming)
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
const decodeInfo = Schema.decodeUnknownOption(
  Schema.Struct({
    version: Schema.String,
    pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
)

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
  readonly compatible: boolean
}

const probe = Effect.fnUntraced(function* (info: Info) {
  return (yield* probeResult(info)).service
})

const probeResult = Effect.fnUntraced(function* (
  info: Info,
  timeout = defaultEnsureTiming.requestTimeout,
) {
  const endpoint = {
    url: info.url,
    auth:
      info.password === undefined
        ? undefined
        : { type: "basic" as const, username: "opencode", password: info.password },
  } satisfies Endpoint
  const signal = AbortSignal.timeout(timeout)
  const result = yield* Effect.promise(() =>
    fetch(new URL("/api/info", info.url), { headers: headers(endpoint), signal })
      .then(async (response) => ({
        response,
        body: response.status === 404 ? undefined : ((await response.json()) as unknown),
      }))
      .then(
        (value) => ({ value }),
        (cause: unknown) => ({ cause }),
      ),
  )
  if ("cause" in result) return { service: undefined, timedOut: signal.aborted }
  const response = result.value.response
  // The previous V2 service exposes /api/status instead. Its authenticated 404 is enough
  // to recognize the registered daemon as incompatible and route it through replacement.
  if (response.status === 404)
    return {
      service: {
        info,
        endpoint,
        version: info.version,
        state: "ready" as const,
        compatible: false,
      } satisfies LocalService,
      timedOut: false,
    }
  const body = result.value.body
  const serverInfo = decodeInfo(body)
  if (Option.isSome(serverInfo)) {
    if (serverInfo.value.pid !== info.pid) return { service: undefined, timedOut: false }
    if (info.version !== undefined && serverInfo.value.version !== info.version)
      return { service: undefined, timedOut: false }
    return {
      service: {
        info,
        endpoint,
        version: serverInfo.value.version,
        state: response.ok ? "ready" : response.status === 500 ? "failed" : "waiting",
        compatible: true,
      } satisfies LocalService,
      timedOut: false,
    }
  }
  return { service: undefined, timedOut: false }
})

const registered = Effect.fnUntraced(function* (file?: string, timeout?: number) {
  const info = yield* read(file)
  if (info === undefined) return { info: undefined, service: undefined, timedOut: false }
  return { info, ...(yield* probeResult(info, timeout)) }
})

// 50ms cadence bounded at ~5s, shared by stop escalation and each ensure
// discovery window.
const poll = (timing: EnsureTiming) =>
  Schedule.max([Schedule.spaced(timing.stopPollInterval), Schedule.recurs(timing.stopPollAttempts)])

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

const terminate = Effect.fnUntraced(function* (info: Info, options: { readonly file?: string }, timing: EnsureTiming) {
  const current = yield* read(options.file)
  if (current === undefined || !same(current, info)) return
  yield* signal(info.pid, "SIGTERM")
  const done = yield* stopped(info.pid).pipe(Effect.retry(poll(timing)), Effect.option)
  if (Option.isNone(done)) {
    const latest = yield* read(options.file)
    if (latest === undefined || !same(latest, info)) return
    yield* signal(info.pid, "SIGKILL")
    yield* stopped(info.pid).pipe(Effect.retry(poll(timing)))
  }
  const latest = yield* read(options.file)
  if (latest === undefined || !same(latest, info)) return
  const fs = yield* FileSystem.FileSystem
  yield* fs.remove(options.file ?? fallback()).pipe(Effect.ignore)
})

/** Effect-based local service lifecycle operations. */
export const Service = { discover, incumbent, ensure, stop, headers, Info }
