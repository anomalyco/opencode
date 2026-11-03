import { expect, test } from "bun:test"
import { splitAddedPatch } from "../../src/util/diff"

test("splits a complete new-file patch into independently numbered chunks", () => {
  const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,5 @@
+one
+++value beginning with plus signs
+three
+four
+five`
  const chunks = splitAddedPatch(patch, 2)!
  expect(chunks.map((chunk) => chunk.rows)).toEqual([2, 2, 1])
  expect(chunks.map((chunk) => chunk.patch.match(/@@ -0,0 \+(\d+),(\d+) @@/)?.slice(1))).toEqual([
    ["1", "2"],
    ["3", "2"],
    ["5", "1"],
  ])
  expect(chunks.flatMap((chunk) => chunk.lines)).toEqual([
    "+one",
    "+++value beginning with plus signs",
    "+three",
    "+four",
    "+five",
  ])
  expect(chunks.every((chunk) => chunk.patch.startsWith("diff --git a/new.txt b/new.txt"))).toBe(true)
})

test("retains a missing-final-newline marker only on the last chunk", () => {
  const patch = `--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,3 @@\n+one\n+two\n+three\n\\ No newline at end of file\n`
  const chunks = splitAddedPatch(patch, 2)!
  expect(chunks).toHaveLength(2)
  expect(chunks[0].patch).not.toContain("No newline")
  expect(chunks[1].patch).toContain("+three\n\\ No newline at end of file")
})

test("does not split partial or mixed patches", () => {
  expect(splitAddedPatch("@@ -1 +1 @@\n-before\n+after", 2)).toBeUndefined()
  expect(splitAddedPatch("@@ -0,0 +1,3 @@\n+one\n+two", 2)).toBeUndefined()
  expect(splitAddedPatch("@@ -0,0 +1,2 @@\n+one\n two", 2)).toBeUndefined()
})
