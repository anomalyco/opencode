import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { patchFile, patchFileGroups, patchFiles } from "./apply-patch-file"
import { text } from "./session-diff"

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

  test.each(["\n", "\r\n"])("preserves complete chained contents with %j line endings", (newline) => {
    const before = `const count = 1${newline}export { count }`
    const middle = `const count = 2${newline}export { count }`
    const after = `const count = 3${newline}export { count }`
    const groups = patchFileGroups(
      [before, middle].map((value, index) => ({
        file: "count.ts",
        patch: createTwoFilesPatch("count.ts", "count.ts", value, index === 0 ? middle : after, "", "", {
          context: Infinity,
        }),
        status: "modified",
        additions: 1,
        deletions: 1,
      })),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ type: "update", additions: 1, deletions: 1 })
    expect(groups[0]!.views).toHaveLength(1)
    expect(text(groups[0]!.views[0]!, "deletions")).toBe(before)
    expect(text(groups[0]!.views[0]!, "additions")).toBe(after)
    expect(groups[0]!.views).toBe(groups[0]!.views)
  })

  test("uses net counts for complete patches instead of producer counts", () => {
    const groups = patchFileGroups([
      {
        file: "count.ts",
        patch: createTwoFilesPatch("count.ts", "count.ts", "one\n", "two\n", "", "", { context: Infinity }),
        status: "modified",
        additions: 4,
        deletions: 5,
      },
    ])
    expect(groups[0]).toMatchObject({ additions: 1, deletions: 1 })
    expect(groups[0]!.views[0]).toMatchObject({ additions: 1, deletions: 1 })
  })

  test("keeps disconnected complete patches separate and preserves file order", () => {
    const groups = patchFileGroups(
      [
        ["b.ts", "one\n", "two\n"],
        ["a.ts", "first\n", "second\n"],
        ["b.ts", "three\n", "four\n"],
      ].map(([file, before, after]) => ({
        file,
        patch: createTwoFilesPatch(file!, file!, before!, after!, "", "", { context: Infinity }),
        status: "modified",
        additions: 1,
        deletions: 1,
      })),
    )
    expect(groups.map((group) => group.path)).toEqual(["b.ts", "a.ts"])
    expect(groups[0]).toMatchObject({ additions: 2, deletions: 2 })
    expect(groups[0]!.views.map((view) => text(view, "additions"))).toEqual(["two\n", "four\n"])
  })

  test.each([
    ["", "created\n", "", "added", "deleted", "delete", 0, 0],
    ["original\n", "changed\n", "original\n", "modified", "modified", "update", 0, 0],
    ["", "created\n", "changed\n", "added", "modified", "add", 1, 0],
  ])("preserves chain status and cancellation %#", (before, middle, after, first, last, type, additions, deletions) => {
    const groups = patchFileGroups(
      [
        { before, after: middle, status: first },
        { before: middle, after, status: last },
      ].map((value) => ({
        file: "chain.ts",
        patch: createTwoFilesPatch("chain.ts", "chain.ts", value.before, value.after, "", "", { context: Infinity }),
        status: value.status,
        additions: 1,
        deletions: 1,
      })),
    )
    expect(groups[0]).toMatchObject({ type, additions, deletions })
    expect(groups[0]!.views).toHaveLength(1)
    expect(text(groups[0]!.views[0]!, "deletions")).toBe(before)
    expect(text(groups[0]!.views[0]!, "additions")).toBe(after)
  })
})
