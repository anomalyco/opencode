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

export class FileTimeService extends ServiceMap.Service<FileTimeService, FileTimeService.Service>()(
  "@opencode/FileTime",
) {
  static readonly layer = Layer.effect(
    FileTimeService,
    Effect.gen(function* () {
      const disableCheck = yield* Flag.OPENCODE_DISABLE_FILETIME_CHECK
      const reads: { [sessionID: string]: { [path: string]: Date | undefined } } = {}
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
          reads[sessionID][file] = new Date()
        }),

        get: Effect.fn("FileTimeService.get")(function* (sessionID: string, file: string) {
          return reads[sessionID]?.[file]
        }),

        assert: Effect.fn("FileTimeService.assert")(function* (sessionID: string, filepath: string) {
          if (disableCheck) return

          const time = reads[sessionID]?.[filepath]
          if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
          const mtime = Filesystem.stat(filepath)?.mtime
          if (mtime && mtime.getTime() > time.getTime() + 50) {
            throw new Error(
              `File ${filepath} has been modified since it was last read.\nLast modification: ${mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
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
    // Fire-and-forget — callers never await this
    runPromiseInstance(FileTimeService.use((s) => s.read(sessionID, file)))
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
