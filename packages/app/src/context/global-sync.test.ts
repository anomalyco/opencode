import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  canDisposeDirectory,
  estimateRootSessionTotal,
  loadRootSessionsWithFallback,
  pickDirectoriesToEvict,
} from "./global-sync"

const mockSession = (id: string, overrides?: Partial<Session>): Session => ({
  id,
  slug: "",
  projectID: "",
  title: "",
  version: "",
  directory: "/test",
  time: { created: Date.now(), updated: Date.now() },
  ...overrides,
})

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
    const calls: Array<{ directory: string; roots?: boolean; limit?: number }> = []
    let fallback = 0

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
      onFallback: () => {
        fallback += 1
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", limit: 10 }])
    expect(fallback).toBe(0)
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots?: boolean; limit?: number }> = []
    let fallback = 0

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
      onFallback: () => {
        fallback += 1
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([{ directory: "dir", limit: 25 }, { directory: "dir" }])
    expect(fallback).toBe(1)
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

describe("session deduplication logic", () => {
  test("deduplicates sessions by id", () => {
    const sessions: Session[] = [
      mockSession("a"),
      mockSession("b"),
      mockSession("a"),
      mockSession("c"),
      mockSession("b"),
    ]

    const seen = new Set<string>()
    const deduplicated = sessions.filter((s) => {
      if (!s.id) return false
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })

    expect(deduplicated).toHaveLength(3)
    expect(deduplicated.map((s) => s.id)).toEqual(["a", "b", "c"])
  })

  test("combines non-archived and child sessions with deduplication", () => {
    const fetched: Session[] = [mockSession("root-1"), mockSession("root-2"), mockSession("root-1")]
    const existingChildren: Session[] = [
      mockSession("child-1", { parentID: "root-1" }),
      mockSession("child-2", { parentID: "root-1" }),
      mockSession("child-1", { parentID: "root-1" }),
    ]

    const nonArchived = fetched.filter((s) => !s.time?.archived)
    const childSessions = existingChildren.filter((s) => !!s.parentID)

    const seen = new Set<string>()
    const deduplicated = [...nonArchived, ...childSessions].filter((s) => {
      if (!s.id) return false
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })

    expect(deduplicated).toHaveLength(4)
    const ids = deduplicated.map((s) => s.id)
    expect(ids).toContain("root-1")
    expect(ids).toContain("root-2")
    expect(ids).toContain("child-1")
    expect(ids).toContain("child-2")
  })

  test("filters out archived sessions before deduplication", () => {
    const sessions: Session[] = [
      mockSession("active-1"),
      mockSession("archived-1", { time: { created: Date.now(), updated: Date.now(), archived: Date.now() } }),
      mockSession("active-2"),
      mockSession("archived-1", { time: { created: Date.now(), updated: Date.now(), archived: Date.now() } }),
    ]

    const nonArchived = sessions.filter((s) => !s.time?.archived)
    const seen = new Set<string>()
    const deduplicated = nonArchived.filter((s) => {
      if (!s.id) return false
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })

    expect(deduplicated).toHaveLength(2)
    expect(deduplicated.map((s) => s.id)).toEqual(["active-1", "active-2"])
  })
})
