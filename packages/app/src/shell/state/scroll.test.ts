import { describe, expect, test, vi } from "bun:test"
import { createScrollPersistence, type SessionScroll } from "./scroll"

describe("createScrollPersistence", () => {
  test("debounces persisted scroll writes", () => {
    vi.useFakeTimers()

    try {
      const snapshot = new Map<string, Record<string, SessionScroll>>([["session", { review: { x: 0, y: 0 } }]])

      const writes: Array<Record<string, SessionScroll>> = []

      const scroll = createScrollPersistence({
        debounceMs: 10,
        getSnapshot: (sessionKey) => snapshot.get(sessionKey),
        onFlush: (sessionKey, next) => {
          snapshot.set(sessionKey, next)
          writes.push(next)
        },
      })

      for (const i of Array.from({ length: 30 }, (_, n) => n + 1)) {
        scroll.setScroll("session", "review", { x: 0, y: i })
      }

      vi.advanceTimersByTime(9)
      expect(writes).toHaveLength(0)

      vi.advanceTimersByTime(1)

      expect(writes).toHaveLength(1)
      expect(writes[0]?.review).toEqual({ x: 0, y: 30 })

      scroll.setScroll("session", "review", { x: 0, y: 30 })
      vi.advanceTimersByTime(20)

      expect(writes).toHaveLength(1)
      scroll.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("disposing writes the last position instead of dropping its pending debounce", () => {
    vi.useFakeTimers()

    try {
      const writes: Array<[string, Record<string, SessionScroll>]> = []

      const scroll = createScrollPersistence({
        debounceMs: 250,
        getSnapshot: () => undefined,
        onFlush: (sessionKey, next) => writes.push([sessionKey, next]),
      })

      scroll.setScroll("session", "review", { x: 0, y: 120 })
      scroll.dispose()
      vi.advanceTimersByTime(250)
      scroll.setScroll("session", "review", { x: 0, y: 240 })
      vi.advanceTimersByTime(250)

      expect(writes).toEqual([["session", { review: { x: 0, y: 120 } }]])
    } finally {
      vi.useRealTimers()
    }
  })

  test("reseeds empty cache after persisted snapshot loads", () => {
    const snapshot = new Map<string, Record<string, SessionScroll>>([["session", {}]])

    const scroll = createScrollPersistence({
      getSnapshot: (sessionKey) => snapshot.get(sessionKey),
      onFlush: () => {},
    })

    expect(scroll.scroll("session", "review")).toBeUndefined()

    snapshot.set("session", { review: { x: 12, y: 34 } })

    expect(scroll.scroll("session", "review")).toEqual({ x: 12, y: 34 })
    scroll.dispose()
  })
})
