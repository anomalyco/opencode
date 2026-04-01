import path from "path"
import { Global } from "../global"

export namespace History {
  const FILE = "history.jsonl"
  const MAX = 100

  export type Entry = {
    text: string
    dir: string
    time: number
  }

  function file() {
    return path.join(Global.Path.data, FILE)
  }

  async function read(): Promise<Entry[]> {
    const f = Bun.file(file())
    if (!(await f.exists())) return []
    const text = await f.text()
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Entry
        } catch {
          return null
        }
      })
      .filter((e): e is Entry => e !== null)
  }

  export async function list(dir?: string): Promise<Entry[]> {
    const all = await read()
    if (!dir) return all
    // Per-project ordering: current project floats to top
    const mine = all.filter((e) => e.dir === dir)
    const rest = all.filter((e) => e.dir !== dir)
    return [...mine, ...rest]
  }

  export async function append(text: string, dir: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    let entries = await read()
    // Deduplicate: remove previous entry with same text
    entries = entries.filter((e) => e.text !== trimmed)
    // Add new entry at end
    entries.push({ text: trimmed, dir, time: Date.now() })
    // Evict oldest entries if over limit
    if (entries.length > MAX) entries = entries.slice(entries.length - MAX)

    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await Bun.write(file(), content)
  }

  export async function clear(): Promise<void> {
    await Bun.write(file(), "")
  }
}
