import { describe, expect, test, vi } from "bun:test"
import { BufferedStore } from "./store"

class MemoryStore {
  writes = 0
  private value: Record<string, unknown> = {}

  get store() {
    return { ...this.value }
  }

  set store(value: Record<string, unknown>) {
    this.writes++
    this.value = { ...value }
  }

  get(key: string) {
    return this.value[key]
  }

  has(key: string) {
    return key in this.value
  }
}

describe("BufferedStore", () => {
  test("makes pending changes available immediately", () => {
    const target = new MemoryStore()
    const store = new BufferedStore(target)

    store.set("theme", "dark")

    expect(store.get("theme")).toBe("dark")
    expect(store.has("theme")).toBe(true)
    expect(store.store).toEqual({ theme: "dark" })
    expect(target.store).toEqual({})
    store.flush()
  })

  test("batches changes into one physical write", () => {
    const target = new MemoryStore()
    const store = new BufferedStore(target)

    store.set("prompt", "first")
    store.set("prompt", "latest")
    store.set("cursor", 6)
    store.flush()

    expect(target.writes).toBe(1)
    expect(target.store).toEqual({ prompt: "latest", cursor: 6 })
  })

  test("debounces writes from the latest change", () => {
    vi.useFakeTimers()
    try {
      const target = new MemoryStore()
      const store = new BufferedStore(target, 100)

      store.set("prompt", "first")
      vi.advanceTimersByTime(99)
      store.set("prompt", "latest")
      vi.advanceTimersByTime(99)
      expect(target.writes).toBe(0)

      vi.advanceTimersByTime(1)
      expect(target.writes).toBe(1)
      expect(target.store).toEqual({ prompt: "latest" })
    } finally {
      vi.useRealTimers()
    }
  })

  test("batches deletes and clears", () => {
    const target = new MemoryStore()
    target.store = { first: 1, second: 2 }
    target.writes = 0
    const store = new BufferedStore(target)

    store.delete("first")
    expect(store.has("first")).toBe(false)
    expect(store.store).toEqual({ second: 2 })

    store.clear()
    store.set("latest", 3)
    store.flush()

    expect(target.writes).toBe(1)
    expect(target.store).toEqual({ latest: 3 })
  })
})
