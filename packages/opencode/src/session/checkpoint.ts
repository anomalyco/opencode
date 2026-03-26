import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import fs from "fs"

export interface Checkpoint {
  sessionId: string
  sessionTitle: string | null
  directory: string
  lastMessage: string | null
  timestamp: number
}

const FILE = "checkpoint.json"

function filePath() {
  return path.join(Global.Path.data, FILE)
}

export const SessionCheckpoint = {
  async write(c: Checkpoint): Promise<void> {
    try {
      await Filesystem.writeJson(filePath(), c)
    } catch {
      // non-fatal
    }
  },

  async read(): Promise<Checkpoint | null> {
    try {
      return (await Filesystem.readJson(filePath())) as Checkpoint
    } catch {
      return null
    }
  },

  async clear(): Promise<void> {
    try {
      const { unlink } = await import("fs/promises")
      await unlink(filePath())
    } catch {
      // already gone
    }
  },

  clearSync(): void {
    try {
      fs.unlinkSync(filePath())
    } catch {
      // already gone
    }
  },
}
