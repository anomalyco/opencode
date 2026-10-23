import { expect, test } from "bun:test"
import { parsePruneDuration, selectPruneCandidates } from "../src/commands/handlers/session/prune-core"

function session(id: string, updated: number, parentID?: string, archived?: number) {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    time: { updated, ...(archived === undefined ? {} : { archived }) },
  }
}

test("parses supported prune durations", () => {
  expect(parsePruneDuration("30m")).toBe(30 * 60 * 1000)
  expect(parsePruneDuration("12h")).toBe(12 * 60 * 60 * 1000)
  expect(parsePruneDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000)
  expect(parsePruneDuration("2w")).toBe(14 * 24 * 60 * 60 * 1000)
})

test("rejects invalid or unsafe prune durations", () => {
  expect(parsePruneDuration("0d")).toBeUndefined()
  expect(parsePruneDuration("-1d")).toBeUndefined()
  expect(parsePruneDuration("1y")).toBeUndefined()
  expect(parsePruneDuration("1.5d")).toBeUndefined()
  expect(parsePruneDuration("999999999999999999999d")).toBeUndefined()
})

test("selects only old root families", () => {
  const root = session("root", 10)
  const child = session("child", 20, "root")
  const candidates = selectPruneCandidates([child, root], 100, new Set())

  expect(candidates).toHaveLength(1)
  expect(candidates[0]?.root.id).toBe("root")
  expect(candidates[0]?.sessions.map((item) => item.id)).toEqual(["root", "child"])
})

test("protects families with recent or active sessions", () => {
  const root = session("root", 10)
  const recentChild = session("recent", 200, "root")
  const activeChild = session("active", 20, "root")

  expect(selectPruneCandidates([root, recentChild], 100, new Set())).toEqual([])
  expect(selectPruneCandidates([root, activeChild], 100, new Set(["active"]))).toEqual([])
})

test("skips archived families unless explicitly included", () => {
  const root = session("root", 10, undefined, 20)
  expect(selectPruneCandidates([root], 100, new Set())).toEqual([])
  expect(selectPruneCandidates([root], 100, new Set(), true)).toHaveLength(1)
})
