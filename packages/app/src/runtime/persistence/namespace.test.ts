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

  test("a batch is handed to the driver synchronously, not behind an earlier reply", async () => {
    const memory = memoryDriver()
    const first = Promise.withResolvers<void>()
    memory.driver.update = async (name, insert, remove) => {
      memory.calls.push({ kind: "update", name, insert, remove })
      if (memory.calls.filter((call) => call.kind === "update").length === 1) await first.promise
    }
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "[1]")
    void storage.flush()
    void storage.setItem("tabs", "[2]")
    void storage.flush()
    // Both batches reached the driver while the first reply is still outstanding.
    expect(memory.calls.filter((call) => call.kind === "update").map((call) => call.insert)).toEqual([
      { tabs: "[1]" },
      { tabs: "[2]" },
    ])
    first.resolve()
  })

  test("a pending load or an external change cannot overwrite a value that is in flight", async () => {
    const loaded = Promise.withResolvers<Record<string, string>>()
    const accepted = Promise.withResolvers<void>()
    const driver: NamespaceDriver = {
      items: () => loaded.promise,
      update: () => accepted.promise,
      clear: async () => undefined,
    }
    const storage = createNamespaceStorage(driver, "g", { delay: 10_000 })
    const read = storage.getItem("model")
    void storage.setItem("model", "local")
    void storage.flush()
    storage.accept({ model: "other-window-older" }, [])
    loaded.resolve({ model: "snapshot-older" })
    expect(await read).toBe("local")
    accepted.resolve()
    await storage.flush()
    expect(await storage.getItem("model")).toBe("local")
    storage.accept({ model: "other-window-newer" }, [])
    expect(await storage.getItem("model")).toBe("other-window-newer")
  })

  test("a failed batch does not requeue a value a later batch already replaced", async () => {
    const memory = memoryDriver()
    const replies: PromiseWithResolvers<void>[] = []
    memory.driver.update = async (name, insert, remove) => {
      memory.calls.push({ kind: "update", name, insert, remove })
      const reply = Promise.withResolvers<void>()
      replies.push(reply)
      await reply.promise
      for (const [key, value] of Object.entries(insert)) memory.data.set(name, new Map([[key, value]]))
    }
    const storage = createNamespaceStorage(memory.driver, "w", { delay: 10_000 })
    void storage.setItem("tabs", "old")
    void storage.flush()
    void storage.setItem("tabs", "new")
    void storage.flush()
    replies[0]!.reject(new Error("disk full"))
    replies[1]!.resolve()
    await storage.flush()
    await storage.flush()
    const updates = memory.calls.filter((call) => call.kind === "update")
    expect(updates.map((call) => call.insert)).toEqual([{ tabs: "old" }, { tabs: "new" }])
    expect(memory.data.get("w")?.get("tabs")).toBe("new")
    expect(await storage.getItem("tabs")).toBe("new")
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
