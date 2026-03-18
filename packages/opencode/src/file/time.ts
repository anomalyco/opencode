import { DateTime, Effect, Layer, Semaphore, ServiceMap } from "effect"
import { runPromiseInstance } from "@/effect/runtime"
import { Flag } from "@/flag/flag"
import type { SessionID } from "@/session/schema"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  export type Stamp = {
    readonly read: Date
    readonly mtime: number | undefined
    readonly ctime: number | undefined
    readonly size: number | undefined
  }

  const stamp = Effect.fnUntraced(function* (file: string) {
    const stat = Filesystem.stat(file)
    const size = typeof stat?.size === "bigint" ? Number(stat.size) : stat?.size
    return {
      read: yield* DateTime.nowAsDate,
      mtime: stat?.mtime?.getTime(),
      ctime: stat?.ctime?.getTime(),
      size,
    }
  })

  const session = (reads: Map<SessionID, Map<string, Stamp>>, sessionID: SessionID) => {
    const value = reads.get(sessionID)
    if (value) return value

    const next = new Map<string, Stamp>()
    reads.set(sessionID, next)
    return next
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
      const disableCheck = yield* Flag.OPENCODE_DISABLE_FILETIME_CHECK
      const reads = new Map<SessionID, Map<string, Stamp>>()
      const locks = new Map<string, Semaphore.Semaphore>()

      const getLock = (filepath: string) => {
        const lock = locks.get(filepath)
        if (lock) return lock

        const next = Semaphore.makeUnsafe(1)
        locks.set(filepath, next)
        return next
      }

      const read = Effect.fn("FileTime.read")(function* (sessionID: SessionID, file: string) {
        log.info("read", { sessionID, file })
        session(reads, sessionID).set(file, yield* stamp(file))
      })

      const get = Effect.fn("FileTime.get")(function* (sessionID: SessionID, file: string) {
        return reads.get(sessionID)?.get(file)?.read
      })

      const assert = Effect.fn("FileTime.assert")(function* (sessionID: SessionID, filepath: string) {
        if (disableCheck) return

        const time = reads.get(sessionID)?.get(filepath)
        if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)

        const next = yield* stamp(filepath)
        const changed = next.mtime !== time.mtime || next.ctime !== time.ctime || next.size !== time.size
        if (!changed) return

        throw new Error(
          `File ${filepath} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`,
        )
      })

      const withLock = Effect.fn("FileTime.withLock")(function* <T>(filepath: string, fn: () => Promise<T>) {
        return yield* Effect.promise(fn).pipe(getLock(filepath).withPermits(1))
      })

      return Service.of({ read, get, assert, withLock })
    }),
  )

  export function read(sessionID: SessionID, file: string) {
    return runPromiseInstance(Service.use((s) => s.read(sessionID, file)))
  }

  export function get(sessionID: SessionID, file: string) {
    return runPromiseInstance(Service.use((s) => s.get(sessionID, file)))
  }

  export async function assert(sessionID: SessionID, filepath: string) {
    return runPromiseInstance(Service.use((s) => s.assert(sessionID, filepath)))
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    return runPromiseInstance(Service.use((s) => s.withLock(filepath, fn)))
  }
}
