import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Storage } from "../storage/storage"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })
  export const state = Instance.state(() => {
    const read: {
      [sessionID: string]: {
        [path: string]: Date | undefined
      }
    } = {}
    return {
      read,
    }
  })

  export function read(sessionID: string, file: string) {
    log.info("read", { sessionID, file })
    const { read } = state()
    read[sessionID] = read[sessionID] || {}
    read[sessionID][file] = new Date()

    Storage.write(["filetime", sessionID, Buffer.from(file).toString("base64url")], {
      time: read[sessionID][file]!.toISOString(),
      path: file,
    }).catch(() => {})
  }

  export async function get(sessionID: string, file: string) {
    const memTime = state().read[sessionID]?.[file]
    if (memTime) return memTime

    const stored = await Storage.read<{ time: string; path: string }>([
      "filetime",
      sessionID,
      Buffer.from(file).toString("base64url"),
    ]).catch(() => undefined)

    if (stored?.time) {
      const date = new Date(stored.time)
      const { read } = state()
      read[sessionID] = read[sessionID] || {}
      read[sessionID][file] = date
      return date
    }
    return undefined
  }

  export async function assert(sessionID: string, filepath: string) {
    const time = await get(sessionID, filepath)
    if (!time) throw new Error(`You must read the file ${filepath} before overwriting it. Use the Read tool first`)
    const stats = await Bun.file(filepath).stat()
    if (stats.mtime.getTime() > time.getTime()) {
      throw new Error(
        `File ${filepath} has been modified since it was last read.\nLast modification: ${stats.mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
      )
    }
  }
}
