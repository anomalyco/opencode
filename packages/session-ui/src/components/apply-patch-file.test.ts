import { describe, expect, test } from "bun:test"
import { patchFiles } from "./apply-patch-file"
import { text } from "./session-diff"

describe("apply patch file", () => {
  test("parses v2 patch metadata", () => {
    const file = patchFiles([
      {
        file: "a.ts",
        status: "modified",
        patch:
          "Index: a.ts\n===================================================================\n--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
        additions: 1,
        deletions: 1,
      },
    ])[0]

    expect(file).toBeDefined()
    expect(file?.filePath).toBe("a.ts")
    expect(file?.relativePath).toBe("a.ts")
    expect(file?.type).toBe("update")
    expect(file?.view.fileDiff.name).toBe("a.ts")
    expect(file?.view.fileDiff.isPartial).toBe(true)
    expect(text(file.view, "deletions")).toBe("one\ntwo\n")
    expect(text(file.view, "additions")).toBe("one\nthree\n")
  })

  test("maps all v2 patch statuses", () => {
    expect(
      patchFiles([
        { file: "added.ts", status: "added", patch: "+one", additions: 1, deletions: 0 },
        { file: "deleted.ts", status: "deleted", patch: "-one", additions: 0, deletions: 1 },
        { file: "modified.ts", status: "modified", patch: "-one\n+two", additions: 1, deletions: 1 },
      ]).map((file) => ({ file: file.filePath, type: file.type })),
    ).toEqual([
      { file: "added.ts", type: "add" },
      { file: "deleted.ts", type: "delete" },
      { file: "modified.ts", type: "update" },
    ])
  })

  test("parses legacy patch metadata", () => {
    const file = patchFiles([
      {
        filePath: "/tmp/a.ts",
        relativePath: "a.ts",
        type: "update",
        patch:
          "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
        additions: 1,
        deletions: 1,
      },
    ])[0]

    expect(file).toBeDefined()
    expect(file?.view.fileDiff.name).toBe("a.ts")
    expect(file?.view.fileDiff.isPartial).toBe(false)
    expect(text(file.view, "deletions")).toBe("one\ntwo\n")
    expect(text(file.view, "additions")).toBe("one\nthree\n")
  })

  test("keeps legacy before and after payloads working", () => {
    const file = patchFiles([
      {
        filePath: "/tmp/a.ts",
        relativePath: "a.ts",
        type: "update",
        before: "one\n",
        after: "two\n",
        additions: 1,
        deletions: 1,
      },
    ])[0]

    expect(file).toBeDefined()
    expect(text(file.view, "deletions")).toBe("one\n")
    expect(text(file.view, "additions")).toBe("two\n")
  })
})
