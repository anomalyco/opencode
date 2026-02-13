import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHistory } from "./history"

const DEFAULT_DIR = path.join(os.homedir(), ".claxedo", "state", "pty-history")

export function historyPath(directory: string, id: string, root = process.env.OPENCODE_PTY_HISTORY_DIR || DEFAULT_DIR) {
  const key = Buffer.from(directory).toString("base64url")
  return path.join(root, key, `${id}.log`)
}

export async function createDiskHistory(input: { directory: string; id: string; limit: number }) {
  const file = historyPath(input.directory, input.id)
  const history = createHistory(input.limit)
  let bytes = 0
  let staged = ""
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()

  const compact = () =>
    fs
      .writeFile(file, history.snapshot())
      .then(() => {
        bytes = history.size()
      })
      .catch(() => {})

  const flush = () => {
    if (!staged) return queue
    const chunk = staged
    staged = ""
    queue = queue
      .then(() => fs.appendFile(file, chunk))
      .then(() => {
        bytes += chunk.length
        if (bytes <= input.limit) return
        return compact()
      })
      .catch(() => {})
    return queue
  }

  await fs
    .mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.readFile(file, "utf8"))
    .then((saved) => {
      history.append(saved)
      bytes = history.size()
      if (saved.length === bytes) return
      return compact()
    })
    .catch(() => {})

  return {
    append(data: string) {
      if (!data) return
      history.append(data)
      staged += data
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        void flush()
      }, 8)
    },
    snapshot(max?: number) {
      return history.snapshot(max)
    },
    size() {
      return history.size()
    },
    async close() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      await flush()
      await queue
    },
    async clear() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      staged = ""
      history.clear()
      bytes = 0
      await queue
      await fs.rm(file, { force: true }).catch(() => {})
    },
  }
}
