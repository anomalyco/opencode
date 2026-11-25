import { expect, test } from "bun:test"
import { changeCounts, parseScriptChanges } from "../../../src/routes/session"
import { partPath } from "../../../src/routes/session/grouping/session"

test("a script's changes parse one per change, with or without a patch and counts", () => {
  expect(
    parseScriptChanges([
      { file: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b\n" },
      { file: "a.ts", status: "modified", additions: 2, deletions: 0 },
      { file: "copy.txt", status: "added" },
      { file: "gone.bin", status: "deleted" },
      { file: "", status: "added" },
      { file: "x.ts", status: "renamed" },
      "junk",
    ]).map(({ type, relativePath, patch, additions, deletions }) => [type, relativePath, patch, additions, deletions]),
  ).toEqual([
    ["update", "a.ts", "@@ -1 +1 @@\n-a\n+b\n", 1, 1],
    ["update", "a.ts", "", 2, 0],
    ["add", "copy.txt", "", undefined, undefined],
    ["delete", "gone.bin", "", undefined, undefined],
  ])
})

test("a change without its diff shows its counts, or only its path", () => {
  const text = (file: { additions?: number; deletions?: number }) => {
    const counts = changeCounts(file)
    return counts ? [counts.additions, counts.deletions].filter(Boolean).join(" ") + counts.unit : undefined
  }
  expect(text({ additions: 2, deletions: 0 })).toBe("+2 lines")
  expect(text({ deletions: 40 })).toBe("-40 lines")
  expect(text({ deletions: 1 })).toBe("-1 line")
  expect(text({ additions: 5, deletions: 1 })).toBe("+5 -1 lines")
  expect(text({ additions: 0, deletions: 0 })).toBeUndefined()
  expect(text({})).toBeUndefined()
})

test("a script's changes show with its block: folded into activity at low, standing alone at medium and high", () => {
  expect(partPath({ type: "tool", name: "execute" }, "low")).toEqual(["activity"])
  expect(partPath({ type: "tool", name: "execute" }, "medium")).toEqual([])
  expect(partPath({ type: "tool", name: "execute" }, "high")).toEqual([])
})
