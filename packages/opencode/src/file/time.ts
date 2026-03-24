import { DateTime, Effect, Layer, Option, Semaphore, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Flag } from "@/flag/flag"
import type { SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { Log } from "../util/log"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  export type Stamp = {
    readonly read: Date
    readonly mtime: number | undefined
    readonly size: number | undefined
  }

  const session = (reads: Map<SessionID, Map<string, Stamp>>, sessionID: SessionID) => {
    const value = reads.get(sessionID)
    if (value) return value

    const next = new Map<string, Stamp>()
    reads.set(sessionID, next)
    return next
  }

  interface State {
    reads: Map<SessionID, Map<string, Stamp>>
    locks: Map<string, Semaphore.Semaphore>
  }

  export interface Interface {
    readonly read: (sessionID: SessionID, file: string) => Effect.Effect<void>
    readonly get: (sessionID: SessionID, file: string) => Effect.Effect<Date | undefined>
    readonly assert: (sessionID: SessionID, filepath: string) => Effect.Effect<void>
    readonly withLock: <T>(filepath: string, fn: () => Promise<T>) => Effect.Effect<T>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/FileTime") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const disableCheck = yield* Flag.OPENCODE_DISABLE_FILETIME_CHECK

      const stamp = Effect.fnUntraced(function* (file: string) {
        const info = yield* fsys.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
        return {
          read: yield* DateTime.nowAsDate,
          mtime: info ? Option.getOrUndefined(info.mtime)?.getTime() : undefined,
          size: info ? Number(info.size) : undefined,
        }
      })
      const state = yield* InstanceState.make<State>(
        Effect.fn("FileTime.state")(() =>
          Effect.succeed({
            reads: new Map<SessionID, Map<string, Stamp>>(),
            locks: new Map<string, Semaphore.Semaphore>(),
          }),
        ),
      )

      const getLock = Effect.fn("FileTime.lock")(function* (filepath: string) {
        filepath = Filesystem.normalizePath(filepath)
        const locks = (yield* InstanceState.get(state)).locks
        const lock = locks.get(filepath)
        if (lock) return lock

        const next = Semaphore.makeUnsafe(1)
        locks.set(filepath, next)
        return next
      })

      const read = Effect.fn("FileTime.read")(function* (sessionID: SessionID, file: string) {
        file = Filesystem.normalizePath(file)
        const reads = (yield* InstanceState.get(state)).reads
        log.info("read", { sessionID, file })
        session(reads, sessionID).set(file, yield* stamp(file))
      })

      const get = Effect.fn("FileTime.get")(function* (sessionID: SessionID, file: string) {
        file = Filesystem.normalizePath(file)
        const reads = (yield* InstanceState.get(state)).reads
        return reads.get(sessionID)?.get(file)?.read
      })

      const assert = Effect.fn("FileTime.assert")(function* (sessionID: SessionID, filepath: string) {
        if (disableCheck) return
        filepath = Filesystem.normalizePath(filepath)

        const reads = (yield* InstanceState.get(state)).reads
        const time = reads.get(sessionID)?.get(filepath)
        if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)

        const next = yield* stamp(filepath)
        const changed = next.mtime !== time.mtime || next.size !== time.size
        if (!changed) return

        throw new Error(
          `File ${filepath} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`,
        )
      })

      const withLock = Effect.fn("FileTime.withLock")(function* <T>(filepath: string, fn: () => Promise<T>) {
        return yield* Effect.promise(fn).pipe((yield* getLock(filepath)).withPermits(1))
      })

      return Service.of({ read, get, assert, withLock })
    }),
  ).pipe(Layer.orDie)

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function read(sessionID: SessionID, file: string) {
    return runPromise((s) => s.read(sessionID, file))
  }

  export function get(sessionID: SessionID, file: string) {
    return runPromise((s) => s.get(sessionID, file))
  }

  export async function assert(sessionID: SessionID, filepath: string) {
    return runPromise((s) => s.assert(sessionID, filepath))
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    return runPromise((s) => s.withLock(filepath, fn))
  }
}
