import { DIR_IDLE_TTL_MS, MAX_DIR_STORES } from "./types"
import type { DirectoryKey } from "./utils"

/** A directory's cached store. Each reactive reader pins it while it holds the store. */
export type DirectoryEntry = {
  readonly directory: string
  readonly pins: number
  readonly lastAccessAt: number
}

export type DirectoryCacheState = ReadonlyMap<DirectoryKey, DirectoryEntry>

export type DirectoryCacheEvent =
  | {
      readonly type: "accessed"
      readonly key: DirectoryKey
      readonly directory: string
      /** The reader holds the store until it releases it. */
      readonly pin: boolean
      readonly at: number
    }
  | { readonly type: "released"; readonly key: DirectoryKey; readonly at: number }

export type DirectoryCacheEffect =
  | { readonly type: "create"; readonly key: DirectoryKey; readonly directory: string }
  | { readonly type: "evict"; readonly key: DirectoryKey }

export type DirectoryCacheTransition = {
  readonly state: DirectoryCacheState
  readonly effects: readonly DirectoryCacheEffect[]
}

export function createDirectoryCacheState(): DirectoryCacheState {
  return new Map()
}

export function transitionDirectoryCache(
  state: DirectoryCacheState,
  event: DirectoryCacheEvent,
): DirectoryCacheTransition {
  const entry = state.get(event.key)

  if (event.type === "accessed") {
    const next = new Map(state).set(event.key, {
      directory: entry?.directory ?? event.directory,
      pins: (entry?.pins ?? 0) + (event.pin ? 1 : 0),
      lastAccessAt: event.at,
    })

    return evict(
      next,
      event.at,
      entry ? [] : [{ type: "create", key: event.key, directory: event.directory }],
      event.key,
    )
  }

  if (!entry || entry.pins === 0) return { state, effects: [] }
  const next = new Map(state).set(event.key, { ...entry, pins: entry.pins - 1 })

  if (entry.pins > 1) return { state: next, effects: [] }

  return evict(next, event.at, [])
}

// Unpinned stores leave once idle for the TTL, and the least recently used ones leave while the cache is over its
// limit. The directory just accessed always stays.
function evict(
  entries: Map<DirectoryKey, DirectoryEntry>,
  at: number,
  effects: DirectoryCacheEffect[],
  keep?: DirectoryKey,
): DirectoryCacheTransition {
  const overflow = entries.size - MAX_DIR_STORES

  const evicted = [...entries]
    .filter(([key, entry]) => key !== keep && entry.pins === 0)
    .toSorted(([, a], [, b]) => a.lastAccessAt - b.lastAccessAt)
    .flatMap(([key, entry], index) => (index < overflow || at - entry.lastAccessAt >= DIR_IDLE_TTL_MS ? [key] : []))

  evicted.forEach((key) => entries.delete(key))

  return { state: entries, effects: [...effects, ...evicted.map((key) => ({ type: "evict" as const, key }))] }
}
