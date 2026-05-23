import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  copyProjectSessionTabs,
  createSessionKeyReader,
  ensureSessionKey,
  pruneSessionKeys,
} from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("copyProjectSessionTabs", () => {
  test("copies project workspace tabs without clearing the project key", () => {
    const store: Record<string, { all: string[]; active?: string }> = {
      "/repo/main": { all: ["file://sheet.xlsx"], active: "file://sheet.xlsx" },
    }

    expect(copyProjectSessionTabs(store, "/repo/main", "ses_123")).toBe(true)
    expect(store["/repo/main"]).toEqual({ all: ["file://sheet.xlsx"], active: "file://sheet.xlsx" })
    expect(store["/repo/main/ses_123"]).toEqual({
      all: ["file://sheet.xlsx"],
      active: "file://sheet.xlsx",
    })
  })

  test("normalizes absolute file tabs against slashy project directories", () => {
    const store: Record<string, { all: string[]; active?: string }> = {
      "/repo/main": { all: ["file:///repo/main/src/app.ts"], active: "file:///repo/main/src/app.ts" },
    }

    expect(copyProjectSessionTabs(store, "/repo/main", "ses_123")).toBe(true)
    expect(store["/repo/main/ses_123"]).toEqual({
      all: ["file://src/app.ts"],
      active: "file://src/app.ts",
    })
  })

  test("no-op when project workspace has no open tabs", () => {
    const store: Record<string, { all: string[]; active?: string }> = {
      proj: { all: [] },
    }

    expect(copyProjectSessionTabs(store, "proj", "sess-1")).toBe(false)
    expect(store["proj/sess-1"]).toBeUndefined()
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})
