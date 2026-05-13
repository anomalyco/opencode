import { describe, expect, test } from "bun:test"
import { createCompatApp } from "../src/app"
import { Store } from "../src/store"
import { MemoryExchangeFiles } from "./helpers/memory-exchange-files"

class CountingMem extends MemoryExchangeFiles {
  puts = 0
  override async put(id: string, body: Uint8Array) {
    if (id.startsWith("veritly/unit/")) this.puts += 1
    await super.put(id, body)
  }
}

describe("maybePersistUnit cadence", () => {
  test("persistEveryRev=3 writes unit bundle on create, rev 1, rev 3 only", async () => {
    const mem = new CountingMem()
    const store = new Store(mem, 3)
    const app = createCompatApp(store)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "t" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    expect(mem.puts).toBe(1)

    const bump = (base: number) =>
      app.request(`http://127.0.0.1/universer-api/comb/2/unit/${unitID}/new_changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitID,
          memberID: "x",
          type: 2,
          changeset: { baseRev: base, unitID, memberID: "x", mutations: [] },
        }),
      })

    expect((await bump(0)).status).toBe(200)
    expect(mem.puts).toBe(2)
    expect((await bump(1)).status).toBe(200)
    expect(mem.puts).toBe(2)
    expect((await bump(2)).status).toBe(200)
    expect(mem.puts).toBe(3)
  })
})
