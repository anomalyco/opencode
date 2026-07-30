import { expect, test } from "bun:test"
import { splitPatchHunks } from "../../src/util/diff"

test("splits a per-file patch into independently renderable hunks", () => {
  const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const first = true
-const oldFirst = true
+const newFirst = true
 const afterFirst = true
@@ -20,3 +20,3 @@
 const second = true
-const oldSecond = true
+const newSecond = true
 const afterSecond = true`

  const hunks = splitPatchHunks(patch)

  expect(hunks).toHaveLength(2)
  expect(hunks[0].header).toBe("@@ -1,3 +1,3 @@")
  expect(hunks[1].header).toBe("@@ -20,3 +20,3 @@")
  expect(hunks[0].rows).toBe(3)
  expect(hunks[1].rows).toBe(3)
  expect(hunks[0].patch).toContain("--- a/file.ts\n+++ b/file.ts")
  expect(hunks[1].patch).toContain("--- a/file.ts\n+++ b/file.ts")
  expect(hunks[0].patch).not.toContain("const second")
  expect(hunks[1].patch).not.toContain("const first")
})

test("keeps patches with one or no hunks intact", () => {
  const patch = `--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new`

  expect(splitPatchHunks(patch)).toEqual([{ patch }])
  expect(splitPatchHunks("not a patch")).toEqual([{ patch: "not a patch" }])
})
