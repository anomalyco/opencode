import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

const keep = 2

type Entry = {
  dir: string
  time: number
}

export namespace Memory {
  export async function trim(input?: {
    dir?: string
    keep?: number
  }) {
    const root = input?.dir ?? path.join(Global.Path.log, "memory")
    const max = input?.keep ?? keep
    const list = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const rows = await Promise.all(
      list
        .filter((item) => item.isDirectory())
        .map(async (item) => {
          const dir = path.join(root, item.name)
          const stat = await fs.stat(dir).catch(() => undefined)
          if (!stat) return
          return {
            dir,
            time: stat.mtimeMs,
          } satisfies Entry
        }),
    )
    const dirs = rows
      .filter((item): item is Entry => Boolean(item))
      .sort((a, b) => a.time - b.time)
    if (dirs.length <= max) return
    await Promise.all(dirs.slice(0, -max).map((item) => fs.rm(item.dir, { recursive: true, force: true }).catch(() => {})))
  }
}

