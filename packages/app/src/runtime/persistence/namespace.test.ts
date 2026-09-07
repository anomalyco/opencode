import { describe, expect, test } from "bun:test"
import { createNamespaceStorage, type NamespaceDriver } from "./namespace"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function memoryDriver(initial: Record<string, Record<string, string>> = {}) {
  const data = new Map(Object.entries(initial).map(([name, items]) => [name, new Map(Object.entries(items))]))
  const calls: { kind: string; name: string; insert?: Record<string, string>; remove?: string[] }[] = []
  let fail = false
  const driver: NamespaceDriver = {
    items: async (name) => {
      calls.push({ kind: "items", name })
      return Object.fromEntries(data.get(name) ?? [])
    },
    update: async (name, insert, remove) => {
      calls.push({ kind: "update", name, insert, remove })
      if (fail) throw new Error("disk full")
      const items = data.get(name) ?? new Map()
      for (const [key, value] of Object.entries(insert)) items.set(key, value)
      for (const key of remove) items.delete(key)
      data.set(name, items)
    },
    clear: async (name) => {
      calls.push({ kind: "clear", name })
      data.delete(name)
    },
  }
  return { driver, data, calls, setFail: (value: boolean) => (fail = value) }
}

describe("namespace storage", () => {
  test("loads the namespace once and serves reads from memory", async () => {
    const memory = memoryDriver({ w: { tabs: "[]", recent: "{}" } })
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10 })
    expect(await storage.getItem("tabs")).toBe("[]")
    expect(await storage.getItem("recent")).toBe("{}")
    expect(await storage.getItem("missing")).toBeNull()
    expect(await storage.getLength()).toBe(2)
    expect(memory.calls.filter((call) => call.kind === "items")).toHaveLength(1)
  })

  test("reads its own writes immediately and coalesces them into one update", async () => {
    const memory = memoryDriver()
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10 })
    void storage.setItem("tabs", "[1]")
    void storage.setItem("recent", "{}")
    void storage.setItem("tabs", "[1,2]")
    void storage.removeItem("recent")
    expect(await storage.getItem("tabs")).toBe("[1,2]")
    expect(await storage.getItem("recent")).toBeNull()
    expect(memory.calls.filter((call) => call.kind === "update")).toHaveLength(0)
    await wait(30)
    const updates = memory.calls.filter((call) => call.kind === "update")
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ kind: "update", name: "w", insert: { tabs: "[1,2]" }, remove: ["recent"] })
  })

  test("writes made while loading win over the loaded snapshot", async () => {
    const memory = memoryDriver({ w: { tabs: "old" } })
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10 })
    const read = storage.getItem("tabs")
    void storage.setItem("tabs", "new")
    expect(await read).toBe("new")
  })

  test("flush writes now and resolves after the driver accepted the batch", async () => {
    const memory = memoryDriver()
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "[1]")
    await storage.flush()
    expect(memory.data.get("w")?.get("tabs")).toBe("[1]")
    await storage.flush()
    expect(memory.calls.filter((call) => call.kind === "update")).toHaveLength(1)
  })

  test("a failed update keeps unsuperseded changes queued for the next flush", async () => {
    const memory = memoryDriver()
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10_000 })
    memory.setFail(true)
    void storage.setItem("tabs", "[1]")
    void storage.setItem("recent", "{}")
    await storage.flush()
    expect(memory.data.get("w")).toBeUndefined()
    memory.setFail(false)
    void storage.setItem("tabs", "[2]")
    await storage.flush()
    expect(Object.fromEntries(memory.data.get("w")!)).toEqual({ tabs: "[2]", recent: "{}" })
  })

  test("accept applies external changes except to keys with queued local writes", async () => {
    const memory = memoryDriver({ g: { model: "a", layout: "x" } })
    const storage = createNamespaceStorage(memory.driver, "g", { delay: 10_000 })
    await storage.getItem("model")
    void storage.setItem("layout", "local")
    storage.accept({ model: "b", layout: "remote" }, [])
    expect(await storage.getItem("model")).toBe("b")
    expect(await storage.getItem("layout")).toBe("local")
    storage.accept({}, ["model"])
    expect(await storage.getItem("model")).toBeNull()
  })

  test("clear drops the cache and queued changes and clears the driver", async () => {
    const memory = memoryDriver({ w: { tabs: "[]" } })
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10_000 })
    await storage.getItem("tabs")
    void storage.setItem("recent", "{}")
    await storage.clear()
    expect(await storage.getItem("tabs")).toBeNull()
    expect(await storage.getItem("recent")).toBeNull()
    expect(memory.calls.map((call) => call.kind)).toEqual(["items", "clear"])
  })
})
