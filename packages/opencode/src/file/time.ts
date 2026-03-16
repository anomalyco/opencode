import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { Filesystem } from "../util/filesystem"
import { Effect, Layer, ServiceMap, Semaphore } from "effect"
import { runPromiseInstance } from "@/effect/runtime"

const log = Log.create({ service: "file.time" })

export namespace FileTimeService {
  export interface Service {
    readonly read: (sessionID: string, file: string) => Effect.Effect<void>
    readonly get: (sessionID: string, file: string) => Effect.Effect<Date | undefined>
    readonly assert: (sessionID: string, filepath: string) => Effect.Effect<void>
    readonly withLock: <T>(filepath: string, fn: () => Promise<T>) => Effect.Effect<T>
  }
}

type Stamp = {
  readonly read: Date
  readonly mtime: number | undefined
  readonly ctime: number | undefined
  readonly size: number | undefined
}

function stamp(file: string): Stamp {
  const stat = Filesystem.stat(file)
  const size = typeof stat?.size === "bigint" ? Number(stat.size) : stat?.size
  return {
    read: new Date(),
    mtime: stat?.mtime?.getTime(),
    ctime: stat?.ctime?.getTime(),
    size,
  }
}

export class FileTimeService extends ServiceMap.Service<FileTimeService, FileTimeService.Service>()(
  "@opencode/FileTime",
) {
  static readonly layer = Layer.effect(
    FileTimeService,
    Effect.gen(function* () {
      const disableCheck = yield* Flag.OPENCODE_DISABLE_FILETIME_CHECK
      const reads: { [sessionID: string]: { [path: string]: Stamp | undefined } } = {}
      const locks = new Map<string, Semaphore.Semaphore>()

      function getLock(filepath: string) {
        let lock = locks.get(filepath)
        if (!lock) {
          lock = Semaphore.makeUnsafe(1)
          locks.set(filepath, lock)
        }
        return lock
      }

      return FileTimeService.of({
        read: Effect.fn("FileTimeService.read")(function* (sessionID: string, file: string) {
          log.info("read", { sessionID, file })
          reads[sessionID] = reads[sessionID] || {}
          reads[sessionID][file] = stamp(file)
        }),

        get: Effect.fn("FileTimeService.get")(function* (sessionID: string, file: string) {
          return reads[sessionID]?.[file]?.read
        }),

        assert: Effect.fn("FileTimeService.assert")(function* (sessionID: string, filepath: string) {
          if (disableCheck) return

          const time = reads[sessionID]?.[filepath]
          if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
          const next = stamp(filepath)
          const changed = next.mtime !== time.mtime || next.ctime !== time.ctime || next.size !== time.size

          if (changed) {
            throw new Error(
              `File ${filepath} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`,
            )
          }
        }),

        withLock: Effect.fn("FileTimeService.withLock")(function* <T>(filepath: string, fn: () => Promise<T>) {
          const lock = getLock(filepath)
          return yield* Effect.promise(fn).pipe(lock.withPermits(1))
        }),
      })
    }),
  )
}

// Legacy facade — callers don't need to change
export namespace FileTime {
  export function read(sessionID: string, file: string) {
    return runPromiseInstance(FileTimeService.use((s) => s.read(sessionID, file)))
  }

  export function get(sessionID: string, file: string) {
    return runPromiseInstance(FileTimeService.use((s) => s.get(sessionID, file)))
  }

  export async function assert(sessionID: string, filepath: string) {
    return runPromiseInstance(FileTimeService.use((s) => s.assert(sessionID, filepath)))
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    return runPromiseInstance(FileTimeService.use((s) => s.withLock(filepath, fn)))
  }
}
