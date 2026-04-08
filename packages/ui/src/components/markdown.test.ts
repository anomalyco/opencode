import { describe, expect, test } from "bun:test"
import { fileLink } from "./markdown"

describe("markdown fileLink", () => {
  test("parses relative file paths", () => {
    expect(fileLink(".trellis/tasks/foo/scripts/run.py")).toEqual({
      path: ".trellis/tasks/foo/scripts/run.py",
      line: undefined,
      col: undefined,
    })
  })

  test("parses file paths with line and column", () => {
    expect(fileLink("packages/app/src/app.tsx:12:4")).toEqual({
      path: "packages/app/src/app.tsx",
      line: 12,
      col: 4,
    })
  })

  test("parses file paths with line ranges", () => {
    expect(fileLink("packages/app/src/app.tsx:12-18")).toEqual({
      path: "packages/app/src/app.tsx",
      line: 12,
      col: undefined,
    })
  })

  test("parses hash line references", () => {
    expect(fileLink("/tmp/demo/file.ts#L20C3")).toEqual({
      path: "/tmp/demo/file.ts",
      line: 20,
      col: 3,
    })
  })

  test("ignores urls", () => {
    expect(fileLink("https://opencode.ai/docs/file.ts")).toBeUndefined()
  })

  test("ignores fractions", () => {
    expect(fileLink("9/8")).toBeUndefined()
    expect(fileLink("9/4")).toBeUndefined()
  })

  test("ignores plain slash-separated prose", () => {
    expect(fileLink("mode/Zhu")).toBeUndefined()
  })

  test("ignores inline code commands containing file paths", () => {
    expect(fileLink("pytest tests/test_backend.py tests/test_operator_spaces.py -q")).toBeUndefined()
  })
})
