import { describe, expect, test, vi } from "bun:test"
import type { SyncStorage } from "@solid-primitives/storage"
import { createMemo, createRoot, enableScheduling, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { flushPersisted, persistStore } from "@/runtime/persistence/persist"

type State = { count: number; label: string }

// Holds Solid's transition open the way an unresolved route or UI update does. The memo is the
// reader that keeps the transition pending until the test drains `tasks`.
function transitionSetup() {
  const writes: string[] = []
  const tasks: (() => void)[] = []

  enableScheduling((task) => {
    tasks.push(task)

    return { id: tasks.length, fn: task, startTime: 0, expirationTime: 0 }
  })

  const root = createRoot((dispose) => {
    const [store, setStore] = createStore<State>({ count: 0, label: "" })

    const persist = persistStore({
      store,
      setStore,
      name: "state",
      storage: {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          writes.push(value)
        },
        removeItem: () => {},
      } satisfies SyncStorage,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      delay: 100,
    })

    const rendered = createMemo(() => store.count)

    return { set: persist.setStore, rendered, dispose }
  })

  return { root, tasks, writes }
}

describe("persisted stores edited inside a transition", () => {
  test("saves the edit after the transition commits", async () => {
    vi.useFakeTimers()

    try {
      const { root, tasks, writes } = transitionSetup()
      expect(root.rendered()).toBe(0)

      const committed = startTransition(() => root.set("count", 1))
      await Promise.resolve()
      expect(tasks.length).toBeGreaterThan(0)
      expect(root.rendered()).toBe(0)

      // The save timer runs before Solid commits the transition, so it still sees the old state.
      vi.advanceTimersByTime(100)
      expect(writes).toEqual([])

      while (tasks.length) tasks.shift()!()
      await committed
      expect(root.rendered()).toBe(1)

      vi.advanceTimersByTime(100)
      expect(writes).toEqual([JSON.stringify({ count: 1, label: "" })])

      root.dispose()
    } finally {
      enableScheduling()
      vi.useRealTimers()
    }
  })

  test("flushPersisted saves an edit whose transition outlived the save timer", async () => {
    vi.useFakeTimers()

    try {
      const { root, tasks, writes } = transitionSetup()
      const committed = startTransition(() => root.set("count", 1))
      await Promise.resolve()
      expect(tasks.length).toBeGreaterThan(0)
      vi.advanceTimersByTime(100)
      expect(writes).toEqual([])

      while (tasks.length) tasks.shift()!()
      await committed
      expect(root.rendered()).toBe(1)

      flushPersisted()
      expect(writes).toEqual([JSON.stringify({ count: 1, label: "" })])

      root.dispose()
    } finally {
      enableScheduling()
      vi.useRealTimers()
    }
  })
})
