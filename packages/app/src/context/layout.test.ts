import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createProjectSessionLoader,
  createSessionKeyReader,
  ensureSessionKey,
  pruneSessionKeys,
} from "./layout-helpers"

describe("createProjectSessionLoader", () => {
  test("deduplicates normalized worktrees and loads late projects sequentially", async () => {
    const first = Promise.withResolvers<boolean>()
    const calls: string[] = []
    let active = 0
    let maxActive = 0
    const load = createProjectSessionLoader(async (directory) => {
      calls.push(directory)
      active++
      maxActive = Math.max(maxActive, active)
      if (directory === "/one/") await first.promise
      active--
      return true
    })

    const one = load("/one/")
    const duplicate = load("/one")
    const two = load("/two")
    await Promise.resolve()

    expect(calls).toEqual(["/one/"])
    first.resolve(true)
    await Promise.all([one, duplicate, two])
    await load("/three")

    expect(calls).toEqual(["/one/", "/two", "/three"])
    expect(maxActive).toBe(1)
  })

  test("allows an unsuccessful worktree to retry when scheduled again", async () => {
    let attempts = 0
    const load = createProjectSessionLoader(() => {
      attempts++
      return attempts > 1
    })

    await load("/repo")
    await load("/repo/")

    expect(attempts).toBe(2)
  })

  test("does not start queued work after disposal", async () => {
    const first = Promise.withResolvers<boolean>()
    const calls: string[] = []
    const load = createProjectSessionLoader((directory) => {
      calls.push(directory)
      if (directory === "/one") return first.promise
      return true
    })

    const one = load("/one")
    const two = load("/two")
    await Promise.resolve()
    load.dispose()
    first.resolve(true)
    await Promise.all([one, two])
    await load("/three")

    expect(calls).toEqual(["/one"])
  })
})

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
