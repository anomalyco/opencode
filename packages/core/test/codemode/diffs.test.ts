import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeModeDiffs } from "../../src/codemode/diffs"
import { fileDiff } from "../../src/tool/plugin/file-diff"

const patchResult = (...files: ReturnType<typeof fileDiff>[]) => ({ output: {}, metadata: { files } })

describe("CodeModeDiffs", () => {
  test("changes to one file fold into one entry, its diff from before the first to after the last", () => {
    const diffs = CodeModeDiffs.make()
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)
    const text = (items: string[]) => `${items.join("\n")}\n`
    const first = lines.with(2, "CHANGED 3")
    const second = first.toSpliced(40, 0, "inserted a", "inserted b")
    const third = second.with(3, "CHANGED 4").toSpliced(55, 1)
    const call = (file: ReturnType<typeof fileDiff>) =>
      Effect.runPromise(CodeModeDiffs.around(diffs, "patch", {}, Effect.succeed(patchResult(file))))
    return call(fileDiff("src/app.ts", text(lines), text(first)))
      .then(() => call(fileDiff("src/other.ts", "a\n", "b\n")))
      .then(() => call(fileDiff("src/app.ts", text(first), text(second))))
      .then(() => call(fileDiff("src/app.ts", text(second), text(third))))
      .then(() => {
        const whole = fileDiff("src/app.ts", text(lines), text(third))
        expect(diffs.files()).toEqual([
          { file: "src/app.ts", status: "modified", additions: 4, deletions: 3, patch: whole.patch },
          expect.objectContaining({ file: "src/other.ts", additions: 1, deletions: 1 }),
        ])
      })
  })

  test("a created file stays created, an undone change counts nothing, and a change with no diff stands apart", () => {
    const diffs = CodeModeDiffs.make()
    diffs.record({ ...fileDiff("new.ts", "", "a\nb\n", "added"), status: "added" })
    diffs.record({ ...fileDiff("new.ts", "a\nb\n", "a\nB\nc\n"), status: "modified" })
    diffs.record({ ...fileDiff("undo.ts", "a\n", "b\n"), status: "modified" })
    diffs.record({ ...fileDiff("undo.ts", "b\n", "a\n"), status: "modified" })
    diffs.record({ file: "new.ts", status: "modified", additions: 1, deletions: 0 })
    diffs.record({ file: "new.ts", status: "deleted" })
    expect(diffs.files()).toEqual([
      { ...fileDiff("new.ts", "", "a\nB\nc\n", "added"), status: "added" },
      { ...fileDiff("undo.ts", "a\n", "a\n"), status: "modified" },
      { file: "new.ts", status: "modified", additions: 1, deletions: 0 },
      { file: "new.ts", status: "deleted" },
    ])
  })

  test("diffs that don't line up stay two changes", () => {
    const first = fileDiff("a.ts", "one\ntwo\n", "one\nTWO\n")
    const stale = fileDiff("a.ts", "one\ntwo\n", "one\nthree\n")
    expect(CodeModeDiffs.compose("a.ts", first.patch, stale.patch, "modified")).toBeUndefined()
    const diffs = CodeModeDiffs.make()
    diffs.record({ ...first, status: "modified" })
    diffs.record({ ...stale, status: "modified" })
    expect(diffs.files()).toHaveLength(2)
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
