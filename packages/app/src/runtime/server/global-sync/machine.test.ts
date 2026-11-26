import { describe, expect, test } from "bun:test"
import {
  createDirectoryCacheState,
  transitionDirectoryCache,
  type DirectoryCacheEvent,
  type DirectoryCacheState,
} from "./machine"
import { DIR_IDLE_TTL_MS, MAX_DIR_STORES } from "./types"
import { directoryKey } from "./utils"

function accessed(directory: string, at: number, pin = false): DirectoryCacheEvent {
  return { type: "accessed", key: directoryKey(directory), directory, pin, at }
}

function replay(events: DirectoryCacheEvent[], state = createDirectoryCacheState()) {
  return events.reduce<{ state: DirectoryCacheState; effects: unknown[] }>(
    (result, event) => {
      const next = transitionDirectoryCache(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("transitionDirectoryCache", () => {
  test("creates a directory's store on its first access only", () => {
    const result = replay([accessed("C:\\repo", 1), accessed("C:/repo", 2, true)])

    expect(result.effects).toEqual([{ type: "create", key: directoryKey("C:\\repo"), directory: "C:\\repo" }])
    expect(result.state.get(directoryKey("C:/repo"))).toEqual({ directory: "C:\\repo", pins: 1, lastAccessAt: 2 })
  })

  test("evicts the least recently used store over the limit, then idle stores, keeping pinned ones", () => {
    const start = replay([
      accessed("/pinned", 0, true),
      accessed("/older", 1_000),
      accessed("/newer", 2_000),
      ...Array.from({ length: MAX_DIR_STORES - 3 }, (_, index) => accessed(`/held-${index}`, 3_000, true)),
    ])

    expect(start.state.size).toBe(MAX_DIR_STORES)

    const over = transitionDirectoryCache(start.state, accessed("/next", 4_000))

    expect(over.effects).toEqual([
      { type: "create", key: directoryKey("/next"), directory: "/next" },
      { type: "evict", key: directoryKey("/older") },
    ])
    expect(over.state.size).toBe(MAX_DIR_STORES)

    const idle = transitionDirectoryCache(over.state, accessed("/pinned", DIR_IDLE_TTL_MS + 3_000))

    // `/newer` sat idle for the TTL; `/next` did not yet, and the pinned stores never leave.
    expect(idle.effects).toEqual([{ type: "evict", key: directoryKey("/newer") }])
    expect(idle.state.has(directoryKey("/next"))).toBe(true)
    expect(idle.state.has(directoryKey("/pinned"))).toBe(true)
  })

  test("keeps the directory just accessed when every other store is pinned", () => {
    const pinned = replay(Array.from({ length: MAX_DIR_STORES }, (_, index) => accessed(`/pinned-${index}`, 1, true)))
    const result = transitionDirectoryCache(pinned.state, accessed("/active", 2))

    expect(result.effects).toEqual([{ type: "create", key: directoryKey("/active"), directory: "/active" }])
    expect(result.state.has(directoryKey("/active"))).toBe(true)
  })

  test("evicts a store once its last reader releases it", () => {
    const pinned = replay([
      ...Array.from({ length: MAX_DIR_STORES - 1 }, (_, index) => accessed(`/pinned-${index}`, 2, true)),
      accessed("/held", 1, true),
      accessed("/held", 1, true),
      accessed("/active", 3),
    ])

    expect(pinned.state.size).toBe(MAX_DIR_STORES + 1)

    const once = transitionDirectoryCache(pinned.state, { type: "released", key: directoryKey("/held"), at: 4 })
    expect(once.effects).toEqual([])
    expect(once.state.get(directoryKey("/held"))?.pins).toBe(1)

    const last = transitionDirectoryCache(once.state, { type: "released", key: directoryKey("/held"), at: 4 })
    expect(last.effects).toEqual([{ type: "evict", key: directoryKey("/held") }])
    expect(last.state.size).toBe(MAX_DIR_STORES)
  })

  test("ignores a release of an unknown or unpinned directory", () => {
    const state = replay([accessed("/repo", 1)]).state

    for (const directory of ["/repo", "/unknown"]) {
      const result = transitionDirectoryCache(state, { type: "released", key: directoryKey(directory), at: 2 })
      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    }
  })
})
