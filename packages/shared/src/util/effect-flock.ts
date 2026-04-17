import path from "path"
import os from "os"
import { randomUUID } from "crypto"
import { Context, Effect, Function, Layer, Option, Schedule, Schema } from "effect"
import type { FileSystem, Scope } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { AppFileSystem } from "../filesystem"
import { Global } from "../global"
import { Hash } from "./hash"

export namespace EffectFlock {
  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  export class LockTimeoutError extends Schema.TaggedErrorClass<LockTimeoutError>()("LockTimeoutError", {
    key: Schema.String,
  }) {}

  export class LockCompromisedError extends Schema.TaggedErrorClass<LockCompromisedError>()("LockCompromisedError", {
    detail: Schema.String,
  }) {}

  class ReleaseError extends Schema.TaggedErrorClass<ReleaseError>()("ReleaseError", {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {
    override get message() {
      return this.detail
    }
  }

  /** Internal: signals "lock is held, retry later". Never leaks to callers. */
  class NotAcquired extends Schema.TaggedErrorClass<NotAcquired>()("NotAcquired", {}) {}

  export type LockError = LockTimeoutError | LockCompromisedError

  // ---------------------------------------------------------------------------
  // Timing (baked in — no caller ever overrides these)
  // ---------------------------------------------------------------------------

  const STALE_MS = 60_000
  const TIMEOUT_MS = 5 * 60_000
  const BASE_DELAY_MS = 100
  const MAX_DELAY_MS = 2_000
  const HEARTBEAT_MS = Math.max(100, Math.floor(STALE_MS / 3))

  const retrySchedule = Schedule.exponential(BASE_DELAY_MS, 1.7).pipe(
    Schedule.either(Schedule.spaced(MAX_DELAY_MS)),
    Schedule.jittered,
    Schedule.while((meta) => meta.elapsed < TIMEOUT_MS),
  )

  // ---------------------------------------------------------------------------
  // Lock metadata schema
  // ---------------------------------------------------------------------------

  const LockMetaJson = Schema.fromJsonString(
    Schema.Struct({
      token: Schema.String,
      pid: Schema.Number,
      hostname: Schema.String,
      createdAt: Schema.String,
    }),
  )

  const decodeMeta = Schema.decodeUnknownSync(LockMetaJson)
  const encodeMeta = Schema.encodeSync(LockMetaJson)

  // ---------------------------------------------------------------------------
  // Service
  // ---------------------------------------------------------------------------

  export interface Interface {
    readonly acquire: (key: string, dir?: string) => Effect.Effect<void, LockError, Scope.Scope>
    readonly withLock: {
      (key: string, dir?: string): <A, E, R>(body: Effect.Effect<A, E, R>) => Effect.Effect<A, E | LockError, R>
      <A, E, R>(body: Effect.Effect<A, E, R>, key: string, dir?: string): Effect.Effect<A, E | LockError, R>
    }
  }

  export class Service extends Context.Service<Service, Interface>()("EffectFlock") {}

  // ---------------------------------------------------------------------------
  // Layer
  // ---------------------------------------------------------------------------

  function wall() {
    return performance.timeOrigin + performance.now()
  }

  const mtimeMs = (info: FileSystem.File.Info) => Option.getOrElse(info.mtime, () => new Date(0)).getTime()

  const isPathGone = (e: PlatformError) => e.reason._tag === "NotFound" || e.reason._tag === "Unknown"

  export const layer: Layer.Layer<Service, never, Global.Service | AppFileSystem.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const global = yield* Global.Service
      const fs = yield* AppFileSystem.Service
      const lockRoot = path.join(global.state, "locks")
      const hostname = os.hostname()
      const ensuredDirs = new Set<string>()

      // -- helpers (close over fs) --

      const safeStat = (file: string) =>
        fs.stat(file).pipe(
          Effect.catchIf(isPathGone, () => Effect.void),
          Effect.orDie,
        )

      const forceRemove = (target: string) => fs.remove(target, { recursive: true }).pipe(Effect.ignore)

      /** Atomic mkdir — returns true if created, false if already exists, dies on other errors. */
      const atomicMkdir = (dir: string) =>
        fs.makeDirectory(dir, { mode: 0o700 }).pipe(
          Effect.as(true),
          Effect.catchIf(
            (e) => e.reason._tag === "AlreadyExists",
            () => Effect.succeed(false),
          ),
          Effect.orDie,
        )

      /** Write with exclusive create — compromised error if file already exists. */
      const exclusiveWrite = (filePath: string, content: string, lockDir: string, detail: string) =>
        fs.writeFileString(filePath, content, { flag: "wx" }).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              yield* forceRemove(lockDir)
              return yield* new LockCompromisedError({ detail })
            }),
          ),
        )

      const cleanStaleBreaker = Effect.fnUntraced(function* (breakerPath: string) {
        const bs = yield* safeStat(breakerPath)
        if (bs && wall() - mtimeMs(bs) > STALE_MS) yield* forceRemove(breakerPath)
        return false
      })

      const ensureDir = Effect.fnUntraced(function* (dir: string) {
        if (ensuredDirs.has(dir)) return
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
        ensuredDirs.add(dir)
      })

      const isStale = Effect.fnUntraced(function* (lockDir: string, heartbeatPath: string, metaPath: string) {
        const now = wall()

        const hb = yield* safeStat(heartbeatPath)
        if (hb) return now - mtimeMs(hb) > STALE_MS

        const meta = yield* safeStat(metaPath)
        if (meta) return now - mtimeMs(meta) > STALE_MS

        const dir = yield* safeStat(lockDir)
        if (!dir) return false

        return now - mtimeMs(dir) > STALE_MS
      })

      // -- single lock attempt --

      type Handle = { token: string; metaPath: string; heartbeatPath: string; lockDir: string }

      const tryAcquireLockDir = Effect.fn("EffectFlock.tryAcquire")(function* (lockDir: string) {
        const token = randomUUID()
        const metaPath = path.join(lockDir, "meta.json")
        const heartbeatPath = path.join(lockDir, "heartbeat")

        // Atomic mkdir — the POSIX lock primitive
        const created = yield* atomicMkdir(lockDir)

        if (!created) {
          if (!(yield* isStale(lockDir, heartbeatPath, metaPath))) return yield* new NotAcquired()

          // Stale — race for breaker ownership
          const breakerPath = lockDir + ".breaker"

          const claimed = yield* fs.makeDirectory(breakerPath, { mode: 0o700 }).pipe(
            Effect.as(true),
            Effect.catchIf(
              (e) => e.reason._tag === "AlreadyExists",
              () => cleanStaleBreaker(breakerPath),
            ),
            Effect.catchIf(isPathGone, () => Effect.succeed(false)),
            Effect.orDie,
          )

          if (!claimed) return yield* new NotAcquired()

          // We own the breaker — double-check staleness, nuke, recreate
          const recreated = yield* Effect.gen(function* () {
            if (!(yield* isStale(lockDir, heartbeatPath, metaPath))) return false
            yield* forceRemove(lockDir)
            return yield* atomicMkdir(lockDir)
          }).pipe(Effect.ensuring(forceRemove(breakerPath)))

          if (!recreated) return yield* new NotAcquired()
        }

        // We own the lock dir — write heartbeat + meta with exclusive create
        yield* exclusiveWrite(heartbeatPath, "", lockDir, "heartbeat already existed")

        const metaJson = encodeMeta({ token, pid: process.pid, hostname, createdAt: new Date().toISOString() })
        yield* exclusiveWrite(metaPath, metaJson, lockDir, "meta.json already existed")

        return { token, metaPath, heartbeatPath, lockDir } satisfies Handle
      })

      // -- retry wrapper (preserves Handle type) --

      const acquireHandle = (lockfile: string, key: string): Effect.Effect<Handle, LockError> =>
        tryAcquireLockDir(lockfile).pipe(
          Effect.retry({
            while: (err) => err._tag === "NotAcquired",
            schedule: retrySchedule,
          }),
          Effect.catchTag("NotAcquired", () => Effect.fail(new LockTimeoutError({ key }))),
        )

      // -- release --

      const release = (handle: Handle) =>
        Effect.gen(function* () {
          const raw = yield* fs.readFileString(handle.metaPath).pipe(
            Effect.catch((err) => {
              if (isPathGone(err)) return Effect.die(new ReleaseError({ detail: "metadata missing" }))
              return Effect.die(err)
            }),
          )

          const parsed = yield* Effect.try({
            try: () => decodeMeta(raw),
            catch: (cause) => new ReleaseError({ detail: "metadata invalid", cause }),
          }).pipe(Effect.orDie)

          if (parsed.token !== handle.token) return yield* Effect.die(new ReleaseError({ detail: "token mismatch" }))

          yield* forceRemove(handle.lockDir)
        })

      // -- build service --

      const acquire = Effect.fn("EffectFlock.acquire")(function* (key: string, dir?: string) {
        const lockDir = dir ?? lockRoot
        yield* ensureDir(lockDir)

        const lockfile = path.join(lockDir, Hash.fast(key) + ".lock")

        // acquireRelease: acquire is uninterruptible, release is guaranteed
        const handle = yield* Effect.acquireRelease(acquireHandle(lockfile, key), (handle) => release(handle))

        // Heartbeat fiber — scoped, so it's interrupted before release runs
        yield* fs
          .utimes(handle.heartbeatPath, new Date(), new Date())
          .pipe(Effect.ignore, Effect.repeat(Schedule.spaced(HEARTBEAT_MS)), Effect.forkScoped)
      })

      const withLock: Interface["withLock"] = Function.dual(
        (args) => Effect.isEffect(args[0]),
        <A, E, R>(body: Effect.Effect<A, E, R>, key: string, dir?: string): Effect.Effect<A, E | LockError, R> =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* acquire(key, dir)
              return yield* body
            }),
          ),
      )

      return Service.of({ acquire, withLock })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(Global.layer))
}
