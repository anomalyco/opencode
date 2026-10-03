import { describe, expect, test } from "bun:test"
import { findFileRefs, parseFileRef } from "./file-reference"

describe("parseFileRef", () => {
  test("parses path with line number", () => {
    expect(parseFileRef("a.java:355")).toEqual({ path: "a.java", line: 355, end: undefined })
    expect(parseFileRef("src/components/app.tsx:12")).toEqual({
      path: "src/components/app.tsx",
      line: 12,
      end: undefined,
    })
  })

  test("parses path with line range", () => {
    expect(parseFileRef("a.java:355-360")).toEqual({ path: "a.java", line: 355, end: 360 })
  })

  test("parses bare paths", () => {
    expect(parseFileRef("a.java")).toEqual({ path: "a.java", line: undefined, end: undefined })
    expect(parseFileRef("packages/app/src/pages/session.tsx")).toEqual({
      path: "packages/app/src/pages/session.tsx",
      line: undefined,
      end: undefined,
    })
  })

  test("rejects directory paths without extension", () => {
    expect(parseFileRef("map-component/objecttype/")).toBeUndefined()
    expect(parseFileRef("map-component/objecttype")).toBeUndefined()
  })

  test("rejects non-path tokens", () => {
    expect(parseFileRef("1.2")).toBeUndefined()
    expect(parseFileRef("12:30")).toBeUndefined()
    expect(parseFileRef("foo bar")).toBeUndefined()
    expect(parseFileRef("foo.qqq:5")).toBeUndefined()
    expect(parseFileRef("https://example.com/a.java:355")).toBeUndefined()
    expect(parseFileRef("")).toBeUndefined()
  })
})

describe("findFileRefs", () => {
  test("finds colon references", () => {
    expect(findFileRefs("see a.java:355 for details")).toEqual([{ path: "a.java", line: 355, end: undefined }])
    expect(findFileRefs("fix src/app.ts:12-15 now")).toEqual([{ path: "src/app.ts", line: 12, end: 15 }])
  })

  test("does not match inside urls or version numbers", () => {
    expect(findFileRefs("https://example.com/a.java:355")).toEqual([])
    expect(findFileRefs("v1.2.3:1")).toEqual([])
  })

  test("finds Turkish prose references and links only the path", () => {
    expect(findFileRefs("a.java dosyasının 355. satırında")).toEqual([
      { path: "a.java", line: 355, end: undefined },
    ])
    expect(findFileRefs("a.java 12. satırda hata var")).toEqual([{ path: "a.java", line: 12, end: undefined }])
  })

  test("does not tie a path to another path's line", () => {
    expect(findFileRefs("a.java ve b.java 3. satırda")).toEqual([{ path: "b.java", line: 3, end: undefined }])
  })

  test("finds English prose references", () => {
    expect(findFileRefs("check a.ts around line 42")).toEqual([{ path: "a.ts", line: 42, end: undefined }])
  })
})
