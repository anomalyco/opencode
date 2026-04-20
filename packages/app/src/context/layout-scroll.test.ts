import { describe, expect, test } from "bun:test"
import { createScrollPersistence } from "./layout-scroll"

describe("createScrollPersistence", () => {
  test("debounces persisted scroll writes", async () => {
    const snapshot = {
      session: {
        review: { x: 0, y: 0 },
      },
    } as Record<string, Record<string, { x: number; y: number }>>
    const writes: Array<Record<string, { x: number; y: number }>> = []
    const scroll = createScrollPersistence({
      debounceMs: 10,
      getSnapshot: (sessionKey) => snapshot[sessionKey],
      onFlush: (sessionKey, next) => {
        snapshot[sessionKey] = next
        writes.push(next)
      },
    })

    try {
      for (const i of Array.from({ length: 30 }, (_, n) => n + 1)) {
        scroll.setScroll("session", "review", { x: 0, y: i })
      }

      await Bun.sleep(9)
      expect(writes).toHaveLength(0)

      await Bun.sleep(10)
      expect(writes).toHaveLength(1)
      expect(writes[0]?.review).toEqual({ x: 0, y: 30 })

      scroll.setScroll("session", "review", { x: 0, y: 30 })
      await Bun.sleep(20)

      expect(writes).toHaveLength(1)
    } finally {
      scroll.dispose()
    }
  })

  test("reseeds empty cache after persisted snapshot loads", () => {
    const snapshot = {
      session: {},
    } as Record<string, Record<string, { x: number; y: number }>>

    const scroll = createScrollPersistence({
      getSnapshot: (sessionKey) => snapshot[sessionKey],
      onFlush: () => {},
    })

    expect(scroll.scroll("session", "review")).toBeUndefined()

    snapshot.session = {
      review: { x: 12, y: 34 },
    }

    expect(scroll.scroll("session", "review")).toEqual({ x: 12, y: 34 })
    scroll.dispose()
  })
})
