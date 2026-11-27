import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeModeDiffs } from "../../src/codemode/diffs"
import { fileDiff } from "../../src/tool/plugin/file-diff"

const patchResult = (...files: ReturnType<typeof fileDiff>[]) => ({ output: {}, metadata: { files } })

describe("CodeModeDiffs", () => {
  test("two patches to one file are two changes, in order, each with the diff its result returned", () => {
    const diffs = CodeModeDiffs.make()
    const first = fileDiff("src/app.ts", "one\ntwo\n", "one\nTWO\n")
    const second = fileDiff("src/app.ts", "one\nTWO\n", "one\nTWO\nthree\n")
    const call = (file: ReturnType<typeof fileDiff>) =>
      Effect.runPromise(CodeModeDiffs.around(diffs, "patch", {}, Effect.succeed(patchResult(file))))
    return call(first)
      .then(() => call(second))
      .then(() => {
        expect(diffs.files()).toEqual([
          { file: "src/app.ts", status: "modified", additions: 1, deletions: 1, patch: first.patch },
          { file: "src/app.ts", status: "modified", additions: 1, deletions: 0, patch: second.patch },
        ])
      })
  })

  test("an edit's result gives its diff; a write's created file counts its content, an overwrite keeps no counts", () => {
    const edit = fileDiff("a.ts", "a\n", "b\n")
    expect(CodeModeDiffs.changes("edit", {}, patchResult(edit))).toEqual([
      { file: "a.ts", status: "modified", additions: 1, deletions: 1, patch: edit.patch },
    ])
    expect(
      CodeModeDiffs.changes(
        "write",
        { path: "n.md", content: "# N\nx\n" },
        { output: "Created file successfully: n.md" },
      ),
    ).toMatchObject([{ file: "n.md", status: "added", additions: 2, deletions: 0 }])
    expect(
      CodeModeDiffs.changes("write", { path: "n.md", content: "y\n" }, { output: "Wrote file successfully: n.md" }),
    ).toEqual([{ file: "n.md", status: "modified" }])
    expect(CodeModeDiffs.changes("read", { path: "a.ts" }, patchResult(edit))).toEqual([])
  })

  test("a Bun write reuses its permission diff, an append counts its lines, and a delete has no counts", async () => {
    const diffs = CodeModeDiffs.make()
    const target = { resource: "log.txt" } as Parameters<typeof CodeModeDiffs.written>[0]
    const preview = fileDiff("log.txt", "", "one\n", "added")
    await Effect.runPromise(
      Effect.all([
        CodeModeDiffs.written(target, "added", preview),
        CodeModeDiffs.appended(target, "modified", "two\nthree\n"),
        CodeModeDiffs.written(target, "modified", undefined),
        CodeModeDiffs.record({ file: "gone.txt", status: "deleted" }),
      ]).pipe(Effect.provideService(CodeModeDiffs.Service, diffs)),
    )
    expect(diffs.files()).toEqual([
      { file: "log.txt", status: "added", additions: 1, deletions: 0, patch: preview.patch },
      { file: "log.txt", status: "modified", additions: 2, deletions: 0 },
      { file: "log.txt", status: "modified" },
      { file: "gone.txt", status: "deleted" },
    ])
  })

  test("an overwrite that changed nothing is no change", async () => {
    const diffs = CodeModeDiffs.make()
    const target = { resource: "same.txt" } as Parameters<typeof CodeModeDiffs.written>[0]
    await Effect.runPromise(
      CodeModeDiffs.written(target, "modified", fileDiff("same.txt", "a\n", "a\n")).pipe(
        Effect.provideService(CodeModeDiffs.Service, diffs),
      ),
    )
    expect(diffs.files()).toEqual([])
  })

  test("the patch budget and the change cap apply as changes arrive", () => {
    const diffs = CodeModeDiffs.make()
    const big = "x".repeat(CodeModeDiffs.MAX_PATCH_BYTES)
    diffs.record({ file: "small.txt", status: "added", additions: 1, deletions: 0, patch: "+a" })
    diffs.record({ file: "big.txt", status: "added", additions: 1, deletions: 0, patch: big })
    diffs.record({ file: "after.txt", status: "added", additions: 1, deletions: 0, patch: "+b" })
    expect(diffs.files().map((file) => [file.file, file.patch !== undefined])).toEqual([
      ["small.txt", true],
      ["big.txt", false],
      ["after.txt", true],
    ])
    Array.from({ length: CodeModeDiffs.MAX_FILES }, (_, index) =>
      diffs.record({ file: `f${index}.txt`, status: "deleted" }),
    )
    expect(diffs.files()).toHaveLength(CodeModeDiffs.MAX_FILES)
  })
})
