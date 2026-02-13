import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

// persisted() depends on usePlatform(); mock it to a web platform so it uses localStorage.
mock.module("@/context/platform", () => ({
  usePlatform: () => ({ platform: "web" }),
}))

describe("persisted storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test("corrupted JSON is treated as missing for structured stores (and removed)", async () => {
    localStorage.setItem("k", "{") // invalid JSON
    const { persisted } = await import(`./persist?test=${Date.now()}`)

    createRoot(() => {
      const store = createStore({ a: 1 })
      const out = persisted("k", store as any)
      expect(out[0].a).toBe(1)
      // Trigger createResource evaluation so storage.getItem runs.
      out[3]()
    })

    // makePersisted may read from storage on a scheduled task; allow it to run.
    await new Promise<void>((r) => setTimeout(r, 0))

    const raw = localStorage.getItem("k")
    // We either remove it or rewrite defaults, but it must not stay corrupted.
    if (raw === null) return
    expect(raw).not.toBe("{")
    const parsed = JSON.parse(raw) as any
    expect(parsed.a).toBe(1)
  })
})
