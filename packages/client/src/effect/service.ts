import { Effect, FileSystem, Option, Schedule, Schema } from "effect"
import type { DiscoverOptions, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, spawnServiceContender } from "../service-contender.js"
import { defaultEnsureTiming, ensureTiming, type EnsureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { fallback, headers, type LocalService, probeResult, same } from "../service-probe.js"

export * from "../service.js"
export { headers }
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
  if (info === undefined) return undefined
  const found = (yield* Effect.promise(() => probeResult({ ...info, url: options.url }))).service
  if (!found?.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return { endpoint: found.endpoint, state: found.state }
})

// Idempotent ensure-running: reuses a healthy compatible server, replaces a
// version-mismatched one, and otherwise spawns small contenders until a server
// becomes discoverable. A contender is never killed merely for slow startup.
/** Ensure a healthy, compatible local service is running. */
export const ensure = Effect.fn("service.ensure")(function* (options: EnsureOptions = {}) {
  const timing = ensureTiming(options)
  const pool = contenderPool(timing)
  let timeouts: { readonly info: Info; readonly count: number } | undefined
  let announced = false
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
        pool.evict(info.pid)
        pool.recruitNow()
        timeouts = undefined
      }
    } else timeouts = undefined
    if (service !== undefined) {
      pool.serviceAnswered()
      const versionMatches = matchesVersion(service.version, options)
      const compatible = service.compatible && versionMatches
      if (!service.compatible && versionMatches)
        return yield* Effect.fail(
          new Error(
            "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
          ),
        )
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
      pool.evict(service.info.pid)
      return Option.none<LocalService>()
    }

    const failed = pool.reap()
    if (failed !== undefined) return yield* Effect.fail(failed)
    if (pool.shouldRecruit(info !== undefined)) {
      yield* announce("missing")
      pool.add(yield* spawnContender)
    }
    return Option.none<LocalService>()
  }).pipe(
    Effect.repeat({
      until: Option.isSome,
      // Probes run sequentially, so a slow probe stretches each iteration; bound the loop by wall clock
      // like the Promise variant rather than by attempt count.
      schedule: Schedule.spaced(timing.pollInterval).pipe(Schedule.upTo({ duration: timing.promiseTimeout })),
    }),
    Effect.ensuring(Effect.sync(() => pool.releaseAll())),
  )
  if (Option.isNone(found))
    return yield* Effect.fail(pool.failure() ?? new Error("Timed out waiting for the background service to start"))
  return found.value.endpoint
})

/** Stop the registered local service. */
export const stop = Effect.fn("service.stop")(function* (options: StopOptions = {}) {
  const info = yield* read(options.file)
  // Terminal handoff is best-effort; it must never keep the old service running.
  yield* Effect.tryPromise(() =>
    options.pty === "handoff" && info !== undefined
      ? PtyHandoff.prepare(options.file ?? fallback(), info, defaultEnsureTiming.requestTimeout)
      : PtyHandoff.clear(options.file ?? fallback()),
  ).pipe(Effect.catch((cause) => Effect.logWarning("Failed to prepare persistent terminals for replacement", cause)))
  if (info !== undefined) yield* terminate(info, options, ensureTiming(options))
})

/** Schema for the local service registration file. */
export const Info = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.optional(Schema.String),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))
// A missing or corrupt file means no valid info; callers treat both
// the same (the registering server self-evicts, clients rediscover).
const read = Effect.fnUntraced(function* (file?: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file ?? fallback()).pipe(Effect.option)
  if (Option.isNone(text)) return undefined
  return yield* decode(text.value).pipe(Effect.option, Effect.map(Option.getOrUndefined))
})

const registered = Effect.fnUntraced(function* (file?: string, timeout?: number) {
  const info = yield* read(file)
  if (info === undefined) return { info: undefined, service: undefined, timedOut: false }
  return { info, ...(yield* Effect.promise(() => probeResult(info, timeout))) }
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

const terminate = Effect.fnUntraced(function* (info: Info, options: { readonly file?: string }, timing: EnsureTiming) {
  const current = yield* read(options.file)
  if (current === undefined || !same(current, info)) return
  yield* signal(info.pid, "SIGTERM")
  const done = yield* stopped(info.pid).pipe(Effect.retry(poll(timing)), Effect.option)
  // The registration can disappear or change hands before this process exits. Only the PID we
  // signalled can tell us whether it has stopped, so escalate based on that process.
  if (Option.isNone(done)) {
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
