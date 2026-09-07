import { describe, expect, test } from "bun:test"
import { createNamespaceStorage, type NamespaceDriver, type NamespaceStorage } from "./namespace"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Call = { kind: string; name: string; insert?: Record<string, string>; remove?: string[] }

// A host with a monotonic revision. Each update is acked to its caller and recorded as an event
// that the test delivers to other windows whenever it chooses, like the real event stream.
function host(initial: Record<string, Record<string, string>> = {}) {
  const data = new Map(Object.entries(initial).map(([name, items]) => [name, new Map(Object.entries(items))]))
  const calls: Call[] = []
  const events: { name: string; insert: Record<string, string>; remove: string[]; revision: number }[] = []
  let revision = 0
  let fail: (insert: Record<string, string>) => boolean = () => false
  let gate: Promise<void> | undefined
  const driver: NamespaceDriver = {
    items: async (name) => {
      calls.push({ kind: "items", name })
      return { items: Object.fromEntries(data.get(name) ?? []), revision }
    },
    update: async (name, insert, remove) => {
      calls.push({ kind: "update", name, insert, remove })
      await gate
      if (fail(insert)) throw new Error("disk full")
      const items = data.get(name) ?? new Map()
      for (const [key, value] of Object.entries(insert)) items.set(key, value)
      for (const key of remove) items.delete(key)
      data.set(name, items)
      events.push({ name, insert, remove, revision: ++revision })
      return revision
    },
    clear: async (name) => {
      calls.push({ kind: "clear", name })
      data.delete(name)
    },
  }
  return {
    driver,
    data,
    calls,
    events,
    updates: () => calls.filter((call) => call.kind === "update"),
    setFail: (value: boolean | ((insert: Record<string, string>) => boolean)) =>
      (fail = typeof value === "boolean" ? () => value : value),
    setGate: (value: Promise<void> | undefined) => (gate = value),
    deliver: (target: NamespaceStorage, index: number) => {
      const event = events[index]!
      target.accept(event.insert, event.remove, event.revision)
    },
  }
}

describe("namespace storage", () => {
  test("loads the namespace once and serves reads from memory", async () => {
    const h = host({ w: { tabs: "[]", recent: "{}" } })
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10 })
    expect(await storage.getItem("tabs")).toBe("[]")
    expect(await storage.getItem("recent")).toBe("{}")
    expect(await storage.getItem("missing")).toBeNull()
    expect(await storage.getLength()).toBe(2)
    expect(h.calls.filter((call) => call.kind === "items")).toHaveLength(1)
  })

  test("reads its own writes immediately and coalesces them into one update", async () => {
    const h = host()
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10 })
    void storage.setItem("tabs", "[1]")
    void storage.setItem("recent", "{}")
    void storage.setItem("tabs", "[1,2]")
    void storage.removeItem("recent")
    expect(await storage.getItem("tabs")).toBe("[1,2]")
    expect(await storage.getItem("recent")).toBeNull()
    expect(h.updates()).toHaveLength(0)
    await wait(30)
    expect(h.updates()).toEqual([{ kind: "update", name: "w", insert: { tabs: "[1,2]" }, remove: ["recent"] }])
  })

  test("writes made while loading win over the loaded snapshot", async () => {
    const h = host({ w: { tabs: "old" } })
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10 })
    const read = storage.getItem("tabs")
    void storage.setItem("tabs", "new")
    expect(await read).toBe("new")
  })

  test("flush writes now and resolves after the driver accepted the batch", async () => {
    const h = host()
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "[1]")
    await storage.flush()
    expect(h.data.get("w")?.get("tabs")).toBe("[1]")
    await storage.flush()
    expect(h.updates()).toHaveLength(1)
  })

  test("a failed update keeps unsuperseded changes queued for the next flush", async () => {
    const h = host()
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10_000 })
    h.setFail(true)
    void storage.setItem("tabs", "[1]")
    void storage.setItem("recent", "{}")
    await storage.flush()
    expect(h.data.get("w")).toBeUndefined()
    h.setFail(false)
    void storage.setItem("tabs", "[2]")
    await storage.flush()
    expect(Object.fromEntries(h.data.get("w")!)).toEqual({ tabs: "[2]", recent: "{}" })
  })

  test("a batch is handed to the driver synchronously, not behind an earlier reply", async () => {
    const h = host()
    const first = Promise.withResolvers<void>()
    h.setGate(first.promise)
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "[1]")
    void storage.flush()
    void storage.setItem("tabs", "[2]")
    void storage.flush()
    // Both batches reached the driver while the first reply is still outstanding.
    expect(h.updates().map((call) => call.insert)).toEqual([{ tabs: "[1]" }, { tabs: "[2]" }])
    first.resolve()
    await storage.flush()
  })

  test("a pending load or an external change cannot overwrite a value that is in flight", async () => {
    const loaded = Promise.withResolvers<{ items: Record<string, string>; revision: number }>()
    const accepted = Promise.withResolvers<number>()
    const driver: NamespaceDriver = {
      items: () => loaded.promise,
      update: () => accepted.promise,
      clear: async () => undefined,
    }
    const storage = createNamespaceStorage(driver, "g", { delay: 10_000 })
    const read = storage.getItem("model")
    void storage.setItem("model", "local")
    void storage.flush()
    storage.accept({ model: "other-window-older" }, [], 1)
    loaded.resolve({ items: { model: "snapshot-older" }, revision: 0 })
    expect(await read).toBe("local")
    accepted.resolve(2)
    await storage.flush()
    expect(await storage.getItem("model")).toBe("local")
    storage.accept({ model: "other-window-newer" }, [], 3)
    expect(await storage.getItem("model")).toBe("other-window-newer")
  })

  test("a failed batch does not requeue a value a later batch already replaced", async () => {
    const h = host()
    const first = Promise.withResolvers<void>()
    h.setGate(first.promise)
    // The first batch (old) is held at the host and will be rejected; the second (new) succeeds.
    h.setFail((insert) => insert.tabs === "old")
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "old")
    void storage.flush()
    h.setGate(undefined)
    void storage.setItem("tabs", "new")
    void storage.flush()
    await wait(0)
    expect(h.data.get("w")?.get("tabs")).toBe("new")
    first.resolve()
    await storage.flush()
    await storage.flush()
    expect(h.updates().map((call) => call.insert)).toEqual([{ tabs: "old" }, { tabs: "new" }])
    expect(h.data.get("w")?.get("tabs")).toBe("new")
    expect(await storage.getItem("tabs")).toBe("new")
  })

  test("an event that reaches a window after a newer ack for the same key is ignored", async () => {
    const h = host({ g: { model: "start" } })
    const one = createNamespaceStorage(h.driver, "g", { delay: 10_000 })
    const two = createNamespaceStorage(h.driver, "g", { delay: 10_000 })
    await one.getItem("model")
    await two.getItem("model")
    void one.setItem("model", "A")
    await one.flush()
    void two.setItem("model", "B")
    await two.flush()
    // Both writes are acked. Now the event for A, which the host applied before B, reaches two.
    h.deliver(two, 0)
    expect(await two.getItem("model")).toBe("B")
    expect(h.data.get("g")?.get("model")).toBe("B")
    // One still receives B, which is newer than its own ack.
    h.deliver(one, 1)
    expect(await one.getItem("model")).toBe("B")
  })

  test("an event held back during an in-flight write wins after the ack if the host applied it later", async () => {
    const h = host()
    const gate = Promise.withResolvers<void>()
    h.setGate(gate.promise)
    const storage = createNamespaceStorage(h.driver, "g", { delay: 10_000 })
    void storage.setItem("model", "mine")
    void storage.flush()
    // Another window's write for the same key landed at the host after ours will.
    storage.accept({ model: "theirs" }, [], 2)
    expect(await storage.getItem("model")).toBe("mine")
    gate.resolve()
    await storage.flush()
    expect(await storage.getItem("model")).toBe("theirs")
  })

  test("an event older than the initial load is ignored", async () => {
    const h = host({ g: { model: "loaded" } })
    void h.driver.update("g", { model: "loaded" }, [])
    await wait(0)
    const storage = createNamespaceStorage(h.driver, "g", { delay: 10_000 })
    await storage.getItem("model")
    storage.accept({ model: "before-load" }, [], 1)
    expect(await storage.getItem("model")).toBe("loaded")
    storage.accept({}, ["model"], 2)
    expect(await storage.getItem("model")).toBeNull()
  })

  test("clear drops the cache and queued changes and clears the driver", async () => {
    const h = host({ w: { tabs: "[]" } })
    const storage = createNamespaceStorage(h.driver, "w", { delay: 10_000 })
    await storage.getItem("tabs")
    void storage.setItem("recent", "{}")
    await storage.clear()
    expect(await storage.getItem("tabs")).toBeNull()
    expect(await storage.getItem("recent")).toBeNull()
    expect(h.calls.map((call) => call.kind)).toEqual(["items", "clear"])
  })
})
