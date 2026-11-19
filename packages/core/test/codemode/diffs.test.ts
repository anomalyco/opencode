import { describe, expect, test } from "bun:test"
import { CodeModeDiffs } from "../../src/codemode/diffs"

describe("CodeModeDiffs", () => {
  test("merges several changes to a file into one diff from its first content to its last", () => {
    const diffs = CodeModeDiffs.make()
    diffs.record("a", "src/app.ts", "one\ntwo\nthree\n", "one\nTWO\nthree\n")
    diffs.record("a", "src/app.ts", "one\nTWO\nthree\n", "one\nTWO\nthree\nfour\n")
    const files = diffs.files()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ file: "src/app.ts", status: "modified", additions: 2, deletions: 1 })
    expect(files[0]?.patch).toContain("-two")
    expect(files[0]?.patch).toContain("+four")
  })

  test("marks written files added and removed files deleted, and drops a file created then removed", () => {
    const diffs = CodeModeDiffs.make()
    diffs.record("n", "notes.md", undefined, "# Notes\n")
    diffs.record("o", "old.txt", "bye\n", undefined)
    diffs.record("t", "tmp.txt", undefined, "x\n")
    diffs.record("t", "tmp.txt", "x\n", undefined)
    diffs.record("b", "logo.png", undefined, { binary: true })
    expect(
      diffs.files().map(({ file, status, additions, deletions }) => ({ file, status, additions, deletions })),
    ).toEqual([
      { file: "notes.md", status: "added", additions: 1, deletions: 0 },
      { file: "old.txt", status: "deleted", additions: 0, deletions: 1 },
      { file: "logo.png", status: "added", additions: 0, deletions: 0 },
    ])
    expect(diffs.files()[2]?.patch).toBeUndefined()
  })

  test("keeps only counts for files past the patch budget", () => {
    const diffs = CodeModeDiffs.make()
    const big = "x".repeat(CodeModeDiffs.MAX_PATCH_BYTES) + "\n"
    diffs.record("s", "small.txt", undefined, "a\n")
    diffs.record("b", "big.txt", undefined, big)
    const [small, large] = diffs.files()
    expect(small?.patch).toBeDefined()
    expect(large).toEqual({ file: "big.txt", status: "added", additions: 1, deletions: 0 })
  })

  test("finds the paths an inner edit, write or patch call names", () => {
    expect(CodeModeDiffs.paths("edit", { path: "a.ts" })).toEqual(["a.ts"])
    expect(CodeModeDiffs.paths("read", { path: "a.ts" })).toEqual([])
    expect(
      CodeModeDiffs.paths("patch", {
        patchText: "*** Begin Patch\n*** Add File: b.ts\n+x\n*** Delete File: c.ts\n*** End Patch",
      }),
    ).toEqual(["b.ts", "c.ts"])
  })
})
