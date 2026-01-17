import { describe, test, expect } from "bun:test"
import { parseDiffStats, formatDiffStats } from "@/cli/cmd/tui/util/diff"

describe("diff utility functions", () => {
  describe("parseDiffStats", () => {
    test("parses added lines", () => {
      const diff = `
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,5 @@
 const x = 1
+const y = 2
+const z = 3
`
      expect(parseDiffStats(diff)).toEqual({ added: 2, removed: 0 })
    })

    test("parses removed lines", () => {
      const diff = `
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,2 @@
 const x = 1
-const y = 2
`
      expect(parseDiffStats(diff)).toEqual({ added: 0, removed: 1 })
    })

    test("parses mixed changes", () => {
      const diff = `
--- a/test.ts
+++ b/test.ts
@@ -1,5 +1,6 @@
 const x = 1
-const old = 2
+const new = 2
+const extra = 3
`
      expect(parseDiffStats(diff)).toEqual({ added: 2, removed: 1 })
    })

    test("handles empty diff", () => {
      expect(parseDiffStats("")).toEqual({ added: 0, removed: 0 })
    })

    test("ignores diff headers", () => {
      const diff = `
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,5 @@
-old line
+new line
`
      expect(parseDiffStats(diff)).toEqual({ added: 1, removed: 1 })
    })

    test("handles multi-hunk diff", () => {
      const diff = `
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 const x = 1
+const y = 2
@@ -5,3 +6,5 @@
 const a = 1
+const b = 2
-const c = 3
`
      expect(parseDiffStats(diff)).toEqual({ added: 2, removed: 1 })
    })
  })

  describe("formatDiffStats", () => {
    test("formats added lines", () => {
      expect(formatDiffStats({ added: 5, removed: 0 })).toBe("+5 lines")
    })

    test("formats removed lines", () => {
      expect(formatDiffStats({ added: 0, removed: 3 })).toBe("-3 lines")
    })

    test("formats mixed changes", () => {
      expect(formatDiffStats({ added: 5, removed: 3 })).toBe("+5, -3 lines")
    })

    test("formats no changes", () => {
      expect(formatDiffStats({ added: 0, removed: 0 })).toBe("0 lines")
    })

    test("formats single added line", () => {
      expect(formatDiffStats({ added: 1, removed: 0 })).toBe("+1 lines")
    })

    test("formats single removed line", () => {
      expect(formatDiffStats({ added: 0, removed: 1 })).toBe("-1 lines")
    })
  })
})
