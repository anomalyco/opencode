import { describe, expect, test } from "bun:test"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import {
  hasSessionDiffs,
  sessionDiffCount,
  sessionDiffIncludes,
  sessionDiffs,
  shouldFetchSessionDiff,
} from "./session-diff"

describe("session diff helpers", () => {
  test("normalize unknown values to arrays", () => {
    const list = [{ file: "a.ts", before: "", after: "", additions: 1, deletions: 0 }] as FileDiff[]

    expect(sessionDiffs(list)).toEqual(list)
    expect(sessionDiffs({})).toEqual([])
    expect(sessionDiffs([{}])).toEqual([])
    expect(sessionDiffs(undefined)).toEqual([])
    expect(hasSessionDiffs(list)).toBe(true)
    expect(hasSessionDiffs({})).toBe(false)
    expect(hasSessionDiffs([{}])).toBe(false)
  })

  test("model the crash-prone consumer operations safely", () => {
    const list = [{ file: "a.ts", before: "", after: "", additions: 1, deletions: 0 }] as FileDiff[]

    expect(sessionDiffCount(list)).toBe(1)
    expect(sessionDiffCount({})).toBe(0)
    expect(sessionDiffIncludes(list, "a.ts")).toBe(true)
    expect(sessionDiffIncludes({}, "a.ts")).toBe(false)
  })

  test("marks malformed cache entries for refetch", () => {
    expect(shouldFetchSessionDiff({}, false)).toBe(true)
    expect(shouldFetchSessionDiff([{}], false)).toBe(true)
    expect(shouldFetchSessionDiff(undefined, false)).toBe(true)
    expect(shouldFetchSessionDiff([], false)).toBe(false)
    expect(shouldFetchSessionDiff([], true)).toBe(true)
  })
})
