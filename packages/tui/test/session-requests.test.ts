import { expect, test } from "bun:test"
import { createComputed, createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionRequests } from "../src/util/session-requests"

test("hydrating empty child requests does not repeatedly publish the family prompt list", () => {
  createRoot((dispose) => {
    try {
      const ids = Array.from({ length: 2600 }, (_, index) => `ses_${index}`)
      const [store, setStore] = createStore<Record<string, string[]>>({})
      let reads = 0
      const requests = createSessionRequests(
        () => ids,
        (id) => {
          reads++
          return store[id]
        },
      )
      let publications = 0
      createComputed(() => {
        requests()
        publications++
      })
      for (const id of ids) setStore(id, [])
      expect(requests()).toEqual([])
      expect(publications).toBe(1)
      expect(reads).toBe(ids.length * 2)
    } finally {
      dispose()
    }
  })
})

test("keeps prompt order and tracks additions, settlement, and family changes", () => {
  createRoot((dispose) => {
    try {
      const [ids, setIDs] = createSignal(["parent", "child"])
      const [store, setStore] = createStore<Record<string, string[]>>({ parent: ["p1"], child: [] })
      const requests = createSessionRequests(ids, (id) => store[id])
      expect(requests()).toEqual(["p1"])
      setStore("child", 0, "c1")
      expect(requests()).toEqual(["p1", "c1"])
      setStore("child", 1, "c2")
      expect(requests()).toEqual(["p1", "c1", "c2"])
      setStore("child", ["c2"])
      expect(requests()).toEqual(["p1", "c2"])
      setIDs(["child", "parent"])
      expect(requests()).toEqual(["c2", "p1"])
      setIDs(["parent"])
      setStore("child", ["hidden"])
      expect(requests()).toEqual(["p1"])
      setIDs(["parent", "child"])
      expect(requests()).toEqual(["p1", "hidden"])
      setStore("parent", [])
      setStore("child", [])
      expect(requests()).toEqual([])
    } finally {
      dispose()
    }
  })
})
