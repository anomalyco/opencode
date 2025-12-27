import { describe, expect, test } from "bun:test"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"

// Skip search tests if rg is not installed to avoid network downloads
const rgPath = Bun.which("rg")
const describeWithRg = rgPath ? describe : describe.skip

describeWithRg("Ripgrep.search", () => {
  test("basic search returns matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.ts"), "export function hello() {}\nexport const world = 1")
      },
    })
    const results = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "export",
    })
    expect(results.length).toBe(2)
    expect(results[0].lines.text).toContain("export")
  })

  test("no matches returns empty array", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    const results = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "xyznonexistentpattern123",
    })
    expect(results).toEqual([])
  })

  test("limit restricts result count", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "many.ts"),
          "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10",
        )
      },
    })
    const results = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "line",
      limit: 3,
    })
    expect(results.length).toBe(3)
  })
})

describe("Ripgrep.parseJsonLines", () => {
  const validMatch = JSON.stringify({
    type: "match",
    data: {
      path: { text: "test.ts" },
      lines: { text: "export const foo = 1" },
      line_number: 1,
      absolute_offset: 0,
      submatches: [{ match: { text: "export" }, start: 0, end: 6 }],
    },
  })

  test("parses valid JSON lines", () => {
    const text = `${validMatch}\n${validMatch}`
    const results = Ripgrep.parseJsonLines(text)
    expect(results.length).toBe(2)
    expect(results[0].lines.text).toContain("export")
  })

  test("skips malformed JSON without crashing", () => {
    // Before the fix, malformed JSON would throw:
    // `SyntaxError: JSON Parse error: Unexpected identifier`
    // and crash the entire search operation.
    const malformed = "{ invalid json"
    const text = `${validMatch}\n${malformed}\n${validMatch}`
    const results = Ripgrep.parseJsonLines(text)
    expect(results.length).toBe(2)
  })

  test("skips structurally invalid JSON without crashing", () => {
    // Valid JSON but wrong shape - should be skipped via safeParse
    const wrongShape = JSON.stringify({ type: "unknown", data: {} })
    const text = `${validMatch}\n${wrongShape}\n${validMatch}`
    const results = Ripgrep.parseJsonLines(text)
    expect(results.length).toBe(2)
  })

  test("returns empty array for empty input", () => {
    expect(Ripgrep.parseJsonLines("")).toEqual([])
    expect(Ripgrep.parseJsonLines("   \n\n  ")).toEqual([])
  })

  test("filters non-match types", () => {
    const begin = JSON.stringify({
      type: "begin",
      data: { path: { text: "test.ts" } },
    })
    const end = JSON.stringify({
      type: "end",
      data: {
        path: { text: "test.ts" },
        binary_offset: null,
        stats: {
          elapsed: { secs: 0, nanos: 1000, human: "0.001s" },
          searches: 1,
          searches_with_match: 1,
          bytes_searched: 100,
          bytes_printed: 50,
          matched_lines: 1,
          matches: 1,
        },
      },
    })
    const text = `${begin}\n${validMatch}\n${end}`
    const results = Ripgrep.parseJsonLines(text)
    expect(results.length).toBe(1)
    expect(results[0].lines.text).toContain("export")
  })
})
