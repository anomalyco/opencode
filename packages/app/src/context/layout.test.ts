import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createSessionKeyReader,
  ensureSessionKey,
  mergeProjectOverrides,
  pruneSessionKeys,
} from "./layout-helpers"

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

describe("mergeProjectOverrides", () => {
  const project = { worktree: "/Users/me/proj/Assets", expanded: false }

  test("surfaces projectMeta name/color/commands for a global project", () => {
    const result = mergeProjectOverrides({
      metadata: { id: "global", worktree: "/" },
      meta: {
        name: "My Assets",
        icon: { color: "mint" },
        commands: { start: "echo hi" },
      },
      iconOverride: undefined,
      project,
    })

    expect(result.name).toBe("My Assets")
    expect(result.icon?.color).toBe("mint")
    expect(result.commands?.start).toBe("echo hi")
    // the opened directory wins over the shared global worktree
    expect(result.worktree).toBe("/Users/me/proj/Assets")
  })

  test("projectMeta icon override takes precedence over database icon", () => {
    const result = mergeProjectOverrides({
      metadata: { id: "global", icon: { url: "data:image/png;base64,db" } },
      meta: { icon: { override: "data:image/png;base64,local" } },
      iconOverride: undefined,
      project,
    })

    expect(result.icon?.override).toBe("data:image/png;base64,local")
    // database fields that aren't overridden are preserved
    expect(result.icon?.url).toBe("data:image/png;base64,db")
  })

  test("per-workspace icon cache wins over projectMeta override", () => {
    const result = mergeProjectOverrides({
      metadata: { id: "p1" },
      meta: { icon: { override: "stale" } },
      iconOverride: "fresh",
      project,
    })

    expect(result.icon?.override).toBe("fresh")
  })

  test("preserves database metadata when no overrides exist", () => {
    const result = mergeProjectOverrides({
      metadata: { id: "p1", name: "Repo", icon: { color: "pink" } },
      meta: undefined,
      iconOverride: undefined,
      project,
    })

    expect(result.name).toBe("Repo")
    expect(result.icon?.color).toBe("pink")
  })
})
