import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })
  const MAX_ENTRIES_PER_SESSION = 500

  export const state = Instance.state(() => {
    const read: {
      [sessionID: string]: {
        [path: string]: Date | undefined
      }
    } = {}
    const locks = new Map<string, Promise<void>>()
    return {
      read,
      locks,
    }
  })

  function evictOldest(sessionID: string) {
    const { read } = state()
    const sessionData = read[sessionID]
    if (!sessionData) return

    const entries = Object.keys(sessionData)
    if (entries.length <= MAX_ENTRIES_PER_SESSION) return

    const sorted = entries.map((k) => ({ k, t: sessionData[k]?.getTime() ?? 0 })).sort((a, b) => a.t - b.t)

    const toRemove = entries.length - MAX_ENTRIES_PER_SESSION
    for (let i = 0; i < toRemove; i++) {
      delete sessionData[sorted[i].k]
    }
  }

  export function read(sessionID: string, file: string) {
    log.info("read", { sessionID, file })
    const { read } = state()
    read[sessionID] = read[sessionID] || {}
    read[sessionID][file] = new Date()
    evictOldest(sessionID)
  }

  export function get(sessionID: string, file: string) {
    return state().read[sessionID]?.[file]
  }

  export function clear(sessionID: string) {
    const { read } = state()
    delete read[sessionID]
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const current = state()
    const currentLock = current.locks.get(filepath) ?? Promise.resolve()
    let release: () => void = () => {}
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = currentLock.then(() => nextLock)
    current.locks.set(filepath, chained)
    await currentLock
    return fn().finally(() => {
      release()
      if (current.locks.get(filepath) === chained) {
        current.locks.delete(filepath)
      }
    })
  }

  export async function assert(sessionID: string, filepath: string) {
    const time = get(sessionID, filepath)
    if (!time) throw new Error(`You must read the file ${filepath} before overwriting it. Use the Read tool first`)
    const stats = await Bun.file(filepath).stat()
    if (stats.mtime.getTime() > time.getTime()) {
      throw new Error(
        `File ${filepath} has been modified since it was last read.\nLast modification: ${stats.mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
      )
    }
  }
}
