import { describe, expect, test } from "bun:test"
import { getDirectoryBootstrapPlan, getDirectorySeed } from "./global-sync/bootstrap"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10 }])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25 },
      { directory: "dir", roots: true },
    ])
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})

describe("getDirectoryBootstrapPlan", () => {
  test("skips duplicated global requests when child store is already seeded", () => {
    const plan = getDirectoryBootstrapPlan({
      skipHeavy: false,
      hasProvider: true,
      hasConfig: true,
      hasPath: true,
    })

    expect(plan.blocking).toEqual(["project", "agent"])
    expect(plan.deferred).toEqual([
      "session_status",
      "sessions",
      "command",
      "mcp",
      "lsp",
      "vcs",
      "permission",
      "question",
    ])
  })

  test("requests provider, config, and path when child store is empty", () => {
    const plan = getDirectoryBootstrapPlan({
      skipHeavy: false,
      hasProvider: false,
      hasConfig: false,
      hasPath: false,
    })

    expect(plan.blocking).toEqual(["project", "provider", "agent", "config"])
    expect(plan.deferred).toEqual([
      "session_status",
      "sessions",
      "path",
      "command",
      "mcp",
      "lsp",
      "vcs",
      "permission",
      "question",
    ])
  })

  test("keeps agent loading even when other global data is already seeded", () => {
    const plan = getDirectoryBootstrapPlan({
      skipHeavy: false,
      hasProvider: true,
      hasConfig: true,
      hasPath: true,
    })

    expect(plan.blocking).toContain("agent")
  })
})

describe("getDirectorySeed", () => {
  test("reuses global path, config, and provider for the matching directory", () => {
    const seed = getDirectorySeed({
      directory: "dir",
      global: {
        path: { directory: "dir", value: "path" },
        config: { value: "config" },
        provider: { value: "provider" },
      },
    })

    expect(seed).toEqual({
      path: { directory: "dir", value: "path" },
      config: { value: "config" },
      provider: { value: "provider" },
    })
  })

  test("does not seed unrelated directories", () => {
    const seed = getDirectorySeed({
      directory: "other",
      global: {
        path: { directory: "dir", value: "path" },
        config: { value: "config" },
        provider: { value: "provider" },
      },
    })

    expect(seed).toEqual({})
  })
})
