import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { patchFile, patchFileGroups, patchFiles } from "./apply-patch-file"

describe("apply patch files", () => {
  test("parses current file diffs", () => {
    const file = patchFile({
      file: "src/session.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      additions: 1,
      deletions: 1,
      status: "modified",
    })

    expect(file?.path).toBe("src/session.ts")
    expect(file?.type).toBe("update")
    expect(file?.view.additions).toBe(1)
  })

  test("keeps only current file diff values", () => {
    expect(
      patchFiles([
        { file: "src/new.ts", patch: "@@ -0,0 +1 @@\n+new", additions: 1, deletions: 0, status: "added" },
        { file: "src/old.ts", patch: "@@ -1 +0,0 @@\n-old", additions: 0, deletions: 1, status: "deleted" },
        { file: "src/incomplete.ts", additions: 1, deletions: 1, status: "modified" },
      ]).map((file) => ({ path: file.path, type: file.type })),
    ).toEqual([
      { path: "src/new.ts", type: "add" },
      { path: "src/old.ts", type: "delete" },
    ])
  })

  test("removes files without diff changes", () => {
    expect(
      patchFiles([
        { file: "src/changed.ts", patch: "@@ -1 +1 @@\n-old\n+new", additions: 1, deletions: 1, status: "modified" },
        { file: "src/unchanged.ts", patch: "", additions: 0, deletions: 0, status: "modified" },
      ]).map((file) => file.path),
    ).toEqual(["src/changed.ts"])
  })

  test("composes sequential complete patches for the same file", () => {
    const before = "const a = 1\nconst b = 2\n"
    const middle = "const a = 2\nconst b = 2\n"
    const after = "const a = 2\nconst b = 3\n"
    const patch = (oldText: string, newText: string) =>
      createTwoFilesPatch("a/src/a.ts", "b/src/a.ts", oldText, newText).replace(
        /^(?:Index: [^\n]+\n)?=+\n/,
        "diff --git a/src/a.ts b/src/a.ts\n",
      )
    const groups = patchFileGroups([
      {
        file: "src/a.ts",
        patch: patch(before, middle),
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: "src/a.ts",
        patch: patch(middle, after),
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.views).toHaveLength(1)
    expect(groups[0]?.additions).toBe(2)
    expect(groups[0]?.deletions).toBe(2)
  })

  test("keeps sequential partial patches under one file", () => {
    const groups = patchFileGroups([
      { file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1, status: "modified" },
      { file: "src/a.ts", patch: "@@ -2 +2 @@\n-c\n+d", additions: 1, deletions: 1, status: "modified" },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.views).toHaveLength(2)
  })
})
