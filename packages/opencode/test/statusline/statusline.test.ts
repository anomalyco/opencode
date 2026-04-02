import { test, expect, describe } from "bun:test"
import { StatusLine } from "../../src/statusline"
import { tmpdir } from "../fixture/fixture"
import os from "os"

describe("format", () => {
  test("basename extracts filename from path", () => {
    expect(StatusLine.format("/Users/foo/bar/project", "basename")).toBe("project")
    expect(StatusLine.format("/a/b/c.txt", "basename")).toBe("c.txt")
    expect(StatusLine.format("single", "basename")).toBe("single")
  })

  test("k formats thousands", () => {
    expect(StatusLine.format("1500", "k")).toBe("2k")
    expect(StatusLine.format("12345", "k")).toBe("12k")
    expect(StatusLine.format("500", "k")).toBe("1k")
    expect(StatusLine.format("0", "k")).toBe("0k")
  })

  test("bar renders progress bar with default width", () => {
    const result = StatusLine.format("50", "bar")
    expect(result.length).toBe(10)
    expect(result).toBe("█████░░░░░")
  })

  test("bar renders progress bar with custom width", () => {
    const result = StatusLine.format("50", "bar20")
    expect(result.length).toBe(20)
  })

  test("bar clamps values to 0-100", () => {
    const full = StatusLine.format("150", "bar5")
    expect(full).toBe("█████")
    const empty = StatusLine.format("-10", "bar5")
    expect(empty).toBe("░░░░░")
  })

  test("bar returns value for non-numeric input", () => {
    expect(StatusLine.format("hello", "bar")).toBe("hello")
  })

  test("k returns value for non-numeric input", () => {
    expect(StatusLine.format("abc", "k")).toBe("abc")
  })

  test("time format as duration", () => {
    const ms = String((1 * 3600 + 23 * 60 + 45) * 1000)
    expect(StatusLine.format(ms, "%H:%M:%S")).toBe("1:23:45")
  })

  test("time format as date", () => {
    const date = new Date(2025, 5, 15, 14, 30, 45)
    const ms = String(date.getTime())
    expect(StatusLine.format(ms, "%Y-%m-%d")).toBe("2025-06-15")
    expect(StatusLine.format(ms, "%H:%M:%S")).toMatch(/\d+:\d{2}:\d{2}/)
  })

  test("time format returns value for non-numeric input", () => {
    expect(StatusLine.format("abc", "%H:%M:%S")).toBe("abc")
  })

  test("unknown spec returns value unchanged", () => {
    expect(StatusLine.format("hello", "unknown")).toBe("hello")
  })
})

describe("resolve", () => {
  test("replaces simple variables", () => {
    const result = StatusLine.resolve("Hello {name}!", { name: "world" })
    expect(result).toBe("Hello world!")
  })

  test("replaces variables with format specs", () => {
    const result = StatusLine.resolve("{dir:basename}", { dir: "/Users/foo/project" })
    expect(result).toBe("project")
  })

  test("replaces multiple variables", () => {
    const result = StatusLine.resolve("{a} - {b} - {c}", { a: "1", b: "2", c: "3" })
    expect(result).toBe("1 - 2 - 3")
  })

  test("missing variables resolve to empty string", () => {
    const result = StatusLine.resolve("Hello {missing}!", {})
    expect(result).toBe("Hello !")
  })

  test("leaves plain text unchanged", () => {
    expect(StatusLine.resolve("no variables here", {})).toBe("no variables here")
  })

  test("handles empty template", () => {
    expect(StatusLine.resolve("", { a: "1" })).toBe("")
  })

  test("handles combined format specs", () => {
    const result = StatusLine.resolve("{tokens:k} tokens, {dir:basename}", {
      tokens: "15000",
      dir: "/Users/foo/project",
    })
    expect(result).toBe("15k tokens, project")
  })

  test("handles shell-prefixed variables", () => {
    const result = StatusLine.resolve("branch: {shell:branch}", { "shell:branch": "main" })
    expect(result).toBe("branch: main")
  })
})

describe("commands", () => {
  test("returns empty object for empty commands", async () => {
    const result = await StatusLine.commands({}, os.tmpdir())
    expect(result).toEqual({})
  })

  test("runs shell command and captures output", async () => {
    const result = await StatusLine.commands({ greeting: "echo hello" }, os.tmpdir())
    expect(result["shell:greeting"]).toBe("hello")
  })

  test("runs multiple commands", async () => {
    const result = await StatusLine.commands(
      {
        a: "echo aaa",
        b: "echo bbb",
      },
      os.tmpdir(),
    )
    expect(result["shell:a"]).toBe("aaa")
    expect(result["shell:b"]).toBe("bbb")
  })

  test("trims trailing whitespace from output", async () => {
    const result = await StatusLine.commands({ ws: "printf 'hello\\n\\n'" }, os.tmpdir())
    expect(result["shell:ws"]).toBe("hello")
  })

  test("handles failing commands gracefully", async () => {
    const result = await StatusLine.commands({ bad: "exit 1" }, os.tmpdir())
    expect(result["shell:bad"]).toBe("")
  })
})
