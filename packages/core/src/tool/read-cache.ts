export * as ReadCache from "./read-cache"

import path from "node:path"
import { Global } from "@bolt-ai/core/global"
import { Hash } from "@bolt-ai/core/util/hash"

// Persistent cache of read-tool line snapshots, keyed per project directory.
// A snapshot is reused only when the file's mtime and size are unchanged, so
// consecutive runs in an untouched tree skip re-streaming and re-formatting
// the same files.
export interface Entry {
  mtime: number
  size: number
  raw: string[]
  count: number
  cut: boolean
  more: boolean
  offset: number
}

interface Store {
  version: 1
  entries: Record<string, Entry>
}

// Bounds the on-disk store; each entry is capped at 50KB of lines by the read
// tool, so the worst case stays around a few megabytes per project.
const MAX_ENTRIES = 100

const stores = new Map<string, Store>()

export function location(directory: string) {
  return path.join(Global.Path.cache, "reads", `${Hash.fast(directory)}.json`)
}

export function key(filepath: string, offset: number, limit: number) {
  return `${filepath}\u0000${offset}\u0000${limit}`
}

async function load(directory: string): Promise<Store> {
  const held = stores.get(directory)
  if (held) return held
  const data: unknown = await Bun.file(location(directory))
    .json()
    .catch(() => undefined)
  const parsed =
    data && typeof data === "object" && (data as Store).version === 1 && typeof (data as Store).entries === "object"
      ? (data as Store)
      : { version: 1 as const, entries: {} }
  stores.set(directory, parsed)
  return parsed
}

export async function get(
  directory: string,
  filepath: string,
  offset: number,
  limit: number,
  stat: { mtime: number; size: number },
) {
  const store = await load(directory)
  const entry = store.entries[key(filepath, offset, limit)]
  if (!entry) return undefined
  if (entry.mtime !== stat.mtime || entry.size !== stat.size) return undefined
  return entry
}

export async function set(directory: string, filepath: string, offset: number, limit: number, entry: Entry) {
  const store = await load(directory)
  const id = key(filepath, offset, limit)
  // Re-inserting moves the entry to the back so eviction drops the oldest.
  delete store.entries[id]
  store.entries[id] = entry
  const ids = Object.keys(store.entries)
  for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) {
    delete store.entries[stale]
  }
  await Bun.write(location(directory), JSON.stringify(store))
}
