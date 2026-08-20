import { describe, expect, test } from "bun:test"
import { patchFile, patchFiles } from "./apply-patch-file"

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
})
