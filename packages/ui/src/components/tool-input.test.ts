import { describe, expect, test } from "bun:test"
import { countPartialStringLines, editPendingDiff, parsePartialToolInput } from "./tool-input"

describe("parsePartialToolInput", () => {
  test("returns undefined for empty / structural-only input", () => {
    expect(parsePartialToolInput("")).toBeUndefined()
    expect(parsePartialToolInput("{")).toBeUndefined()
    expect(parsePartialToolInput('{"foo"')).toBeUndefined()
  })

  test("extracts a closed string field", () => {
    expect(parsePartialToolInput('{"filePath":"/tmp/foo.ts"')).toEqual({ filePath: "/tmp/foo.ts" })
  })

  test("ignores half-arrived string values", () => {
    expect(parsePartialToolInput('{"filePath":"/tmp/foo')).toBeUndefined()
  })

  test("extracts a terminated number followed by comma", () => {
    expect(parsePartialToolInput('{"offset":348,')).toEqual({ offset: 348 })
  })

  test("extracts a terminated number followed by closing brace", () => {
    expect(parsePartialToolInput('{"offset":348}')).toEqual({ offset: 348 })
  })

  test("ignores trailing unterminated numbers", () => {
    expect(parsePartialToolInput('{"offset":34')).toBeUndefined()
  })

  test("extracts multiple terminated fields in a single partial JSON", () => {
    expect(parsePartialToolInput('{"filePath":"/tmp/foo.ts","offset":100,"limit":15,')).toEqual({
      filePath: "/tmp/foo.ts",
      offset: 100,
      limit: 15,
    })
  })

  test("decodes JSON escape sequences inside string values", () => {
    expect(parsePartialToolInput('{"oldString":"line1\\nline2"')).toEqual({ oldString: "line1\nline2" })
  })

  test("extracts terminated boolean values", () => {
    expect(parsePartialToolInput('{"recursive":true,"force":false,')).toEqual({ recursive: true, force: false })
  })
})

describe("countPartialStringLines", () => {
  test("returns 0 when key is absent or input is empty", () => {
    expect(countPartialStringLines("", "content")).toBe(0)
    expect(countPartialStringLines('{"filePath":"/a"', "content")).toBe(0)
  })

  test("returns 1 for a non-empty string with no newline escapes yet", () => {
    expect(countPartialStringLines('{"content":"hello', "content")).toBe(1)
    expect(countPartialStringLines('{"content":"hello"', "content")).toBe(1)
  })

  test("counts JSON-escaped newlines inside an open string", () => {
    expect(countPartialStringLines('{"content":"line1\\nline2\\nline3', "content")).toBe(3)
  })

  test("stops at the closing quote", () => {
    expect(countPartialStringLines('{"content":"a\\nb","other":"\\n\\n"', "content")).toBe(2)
  })

  test("handles other escapes without inflating the count", () => {
    expect(countPartialStringLines('{"content":"a\\tb\\"c', "content")).toBe(1)
  })
})

describe("editPendingDiff", () => {
  test("returns zero when neither side has arrived", () => {
    expect(editPendingDiff({ oldString: undefined, newString: undefined })).toEqual({
      additions: 0,
      deletions: 0,
    })
  })

  test("falls back to line counts when newString is still streaming", () => {
    expect(
      editPendingDiff({
        oldString: "a\nb\nc",
        newString: undefined,
        raw: '{"oldString":"a\\nb\\nc","newString":"x\\ny',
      }),
    ).toEqual({ additions: 2, deletions: 3 })
  })

  test("falls back to line counts when oldString is still streaming", () => {
    expect(
      editPendingDiff({
        oldString: undefined,
        newString: "x\ny\nz",
        raw: '{"newString":"x\\ny\\nz","oldString":"a\\nb',
      }),
    ).toEqual({ additions: 3, deletions: 2 })
  })

  test("uses real line diff once both sides are closed (changed-only is counted)", () => {
    expect(
      editPendingDiff({
        oldString: "a\nb\nc",
        newString: "a\nB\nc",
      }),
    ).toEqual({ additions: 1, deletions: 1 })
  })

  test("oldString fully contained in newString counts only additions", () => {
    expect(
      editPendingDiff({
        oldString: "a\nb\n",
        newString: "a\nb\nc\nd\n",
      }),
    ).toEqual({ additions: 2, deletions: 0 })
  })

  test("newString fully contained in oldString counts only deletions", () => {
    expect(
      editPendingDiff({
        oldString: "a\nb\nc\nd\n",
        newString: "a\nb\n",
      }),
    ).toEqual({ additions: 0, deletions: 2 })
  })

  test("identical strings produce zero diff", () => {
    expect(editPendingDiff({ oldString: "a\nb", newString: "a\nb" })).toEqual({
      additions: 0,
      deletions: 0,
    })
  })

  test("empty oldString reports newString as pure additions", () => {
    expect(editPendingDiff({ oldString: "", newString: "a\nb\nc" })).toEqual({
      additions: 3,
      deletions: 0,
    })
  })
})
