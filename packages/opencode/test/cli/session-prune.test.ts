import { describe, expect, test } from "bun:test"
import type { PruneSession, PruneStatus } from "@/cli/cmd/session-prune-core"
import { parsePruneDuration, selectPruneCandidates } from "@/cli/cmd/session-prune-core"

function session(id: string, updated: number, parentID?: string, extra: Partial<PruneSession> = {}): PruneSession {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    time: { updated },
    ...extra,
  }
}

describe("parsePruneDuration", () => {
  test("parses supported duration suffixes", () => {
    expect(parsePruneDuration("30m")).toBe(30 * 60 * 1000)
    expect(parsePruneDuration("12h")).toBe(12 * 60 * 60 * 1000)
    expect(parsePruneDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000)
    expect(parsePruneDuration("2w")).toBe(14 * 24 * 60 * 60 * 1000)
  })

  test("rejects invalid or unsafe durations", () => {
    expect(parsePruneDuration("0d")).toBeUndefined()
    expect(parsePruneDuration("-1d")).toBeUndefined()
    expect(parsePruneDuration("1y")).toBeUndefined()
    expect(parsePruneDuration("1.5d")).toBeUndefined()
    expect(parsePruneDuration("999999999999999999999d")).toBeUndefined()
  })
})

describe("selectPruneCandidates", () => {
  test("selects an old root family and returns its descendants", () => {
    const root = session("root", 10)
    const child = session("child", 20, "root")
    const result = selectPruneCandidates([child, root], 100, new Map())

    expect(result).toHaveLength(1)
    expect(result[0]?.root.id).toBe("root")
    expect(result[0]?.sessions.map((item) => item.id)).toEqual(["root", "child"])
  })

  test("does not select a root when a descendant is recent", () => {
    const root = session("root", 10)
    const child = session("child", 200, "root")
    expect(selectPruneCandidates([root, child], 100, new Map())).toEqual([])
  })

  test("does not select an active family", () => {
    const root = session("root", 10)
    const child = session("child", 20, "root")
    const active = new Map<string, PruneStatus>([[child.id, { type: "busy" }]])

    expect(selectPruneCandidates([root, child], 100, active)).toEqual([])
  })

  test("skips shared sessions", () => {
    const root = session("root", 10, undefined, { share: { url: "https://example.test/share" } })
    expect(selectPruneCandidates([root], 100, new Map())).toEqual([])
  })
})
