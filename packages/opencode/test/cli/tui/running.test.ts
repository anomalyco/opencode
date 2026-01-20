import { describe, expect, test } from "bun:test"
import { extractToolCommand } from "../../../src/cli/cmd/tui/util/running-utils"

describe("extractToolCommand", () => {
  test("extracts bash command", () => {
    expect(extractToolCommand("bash", { command: "ls -la" })).toBe("ls -la")
  })

  test("falls back to 'bash' when command missing", () => {
    expect(extractToolCommand("bash", {})).toBe("bash")
  })

  test("formats grep with pattern", () => {
    expect(extractToolCommand("grep", { pattern: "foo" })).toBe('rg "foo"')
  })

  test("formats grep with pattern and path", () => {
    expect(extractToolCommand("grep", { pattern: "foo", path: "src" })).toBe('rg "foo" src')
  })

  test("formats glob with pattern", () => {
    expect(extractToolCommand("glob", { pattern: "**/*.ts" })).toBe("glob **/*.ts")
  })

  test("extracts filename for read", () => {
    expect(extractToolCommand("read", { filePath: "/home/user/project/file.ts" })).toBe("read file.ts")
  })

  test("extracts filename for write", () => {
    expect(extractToolCommand("write", { filePath: "/home/user/project/file.ts" })).toBe("write file.ts")
  })

  test("extracts filename for edit", () => {
    expect(extractToolCommand("edit", { filePath: "/home/user/project/file.ts" })).toBe("edit file.ts")
  })

  test("formats task with description", () => {
    expect(extractToolCommand("task", { description: "Search codebase" })).toBe("agent: Search codebase")
  })

  test("falls back to '...' when task description missing", () => {
    expect(extractToolCommand("task", {})).toBe("agent: ...")
  })

  test("formats webfetch with url", () => {
    expect(extractToolCommand("webfetch", { url: "https://example.com" })).toBe("fetch https://example.com")
  })

  test("uses title for unknown tool", () => {
    expect(extractToolCommand("custom", { title: "Custom action" })).toBe("Custom action")
  })

  test("falls back to tool name when title missing", () => {
    expect(extractToolCommand("custom", {})).toBe("custom")
  })

  test("truncates long commands", () => {
    const long = "a".repeat(50)
    const result = extractToolCommand("bash", { command: long })
    expect(result.length).toBe(40)
    expect(result.endsWith("...")).toBe(true)
  })

  test("does not truncate commands at limit", () => {
    const exact = "a".repeat(40)
    expect(extractToolCommand("bash", { command: exact })).toBe(exact)
  })
})
