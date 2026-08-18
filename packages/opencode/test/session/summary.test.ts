import { describe, expect, test } from "bun:test"
import { filesFromToolMetadata } from "../../src/session/summary"

describe("filesFromToolMetadata", () => {
  test("collects write, edit, and apply_patch file metadata", () => {
    expect(filesFromToolMetadata({ filepath: "/project/src/a.ts" })).toEqual(["/project/src/a.ts"])
    expect(filesFromToolMetadata({ filediff: { file: "/project/src/b.ts" } })).toEqual(["/project/src/b.ts"])
    expect(
      filesFromToolMetadata({
        files: [
          { filePath: "/project/src/c.ts", relativePath: "src/c.ts" },
          { filePath: "/project/src/d.ts" },
        ],
      }),
    ).toEqual(["/project/src/c.ts", "/project/src/d.ts"])
  })

  test("ignores unrelated metadata", () => {
    expect(filesFromToolMetadata({ diagnostics: {}, diff: "" })).toEqual([])
    expect(filesFromToolMetadata(undefined)).toEqual([])
  })
})
