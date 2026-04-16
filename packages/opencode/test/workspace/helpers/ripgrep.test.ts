import { describe, expect, test } from "bun:test"
import { parseRgJsonLine, rgArgs } from "../../../src/workspace/helpers/ripgrep"

describe("helpers/ripgrep — rgArgs", () => {
  test("files mode emits --files and the git glob", () => {
    const args = rgArgs({ mode: "files" })
    expect(args).toContain("--files")
    expect(args).toContain("--glob=!.git/*")
  })

  test("search mode emits --json, --no-messages, and the pattern", () => {
    const args = rgArgs({ mode: "search", pattern: "foo" })
    expect(args).toContain("--json")
    expect(args).toContain("--no-messages")
    expect(args[args.indexOf("--") + 1]).toBe("foo")
  })

  test("glob entries each become a --glob argument", () => {
    const args = rgArgs({ mode: "files", glob: ["*.ts", "*.tsx"] })
    expect(args).toContain("--glob=*.ts")
    expect(args).toContain("--glob=*.tsx")
  })

  test("maxDepth, limit, follow, hidden=false flags pass through", () => {
    const args = rgArgs({
      mode: "search",
      pattern: "x",
      glob: [],
      maxDepth: 3,
      limit: 5,
      follow: true,
      hidden: false,
    })
    expect(args).toContain("--max-depth=3")
    expect(args).toContain("--max-count=5")
    expect(args).toContain("--follow")
    expect(args).not.toContain("--hidden")
  })

  test("hidden defaults to true (implicit) — i.e. added unless explicitly false", () => {
    const args = rgArgs({ mode: "files" })
    expect(args).toContain("--hidden")
  })

  test("file list is appended after pattern", () => {
    const args = rgArgs({ mode: "search", pattern: "foo", file: ["a.txt", "b.txt"] })
    const dashDash = args.indexOf("--")
    expect(args[dashDash + 1]).toBe("foo")
    expect(args.slice(dashDash + 2)).toEqual(["a.txt", "b.txt"])
  })

  test("search without explicit files defaults positional to '.'", () => {
    // This guards against rg blocking on stdin when the spawn leaves
    // stdin as an open pipe and no path is given.
    const args = rgArgs({ mode: "search", pattern: "foo" })
    const dashDash = args.indexOf("--")
    expect(args.slice(dashDash + 1)).toEqual(["foo", "."])
  })
})

describe("helpers/ripgrep — parseRgJsonLine", () => {
  test("returns null for non-match rows", () => {
    expect(parseRgJsonLine("")).toBeNull()
    expect(parseRgJsonLine('{"type":"begin","data":{}}')).toBeNull()
    expect(parseRgJsonLine('{"type":"end","data":{}}')).toBeNull()
  })

  test("returns null for invalid JSON", () => {
    expect(parseRgJsonLine("{not json")).toBeNull()
  })

  test("returns typed hit for match rows", () => {
    const line = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/foo.ts" },
        lines: { text: "const x = 1\n" },
        line_number: 10,
        absolute_offset: 123,
        submatches: [{ match: { text: "x" }, start: 6, end: 7 }],
      },
    })
    const hit = parseRgJsonLine(line)
    expect(hit).not.toBeNull()
    expect(hit!.path.text).toBe("src/foo.ts")
    expect(hit!.line_number).toBe(10)
    expect(hit!.submatches[0].match.text).toBe("x")
  })
})
