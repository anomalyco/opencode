import { describe, expect, test } from "bun:test"
import { extractToolCommand } from "../../../src/cli/cmd/tui/util/running-utils"

describe("extractToolCommand", () => {
  // Override cases (grep, task have specific formatting)
  test("formats grep with pattern", () => {
    expect(extractToolCommand("grep", { pattern: "foo" })).toBe('rg "foo"')
  })

  test("formats grep with pattern and path", () => {
    expect(extractToolCommand("grep", { pattern: "foo", path: "src" })).toBe('rg "foo" src')
  })

  test("formats task with description", () => {
    expect(extractToolCommand("task", { description: "Search codebase" })).toBe("agent: Search codebase")
  })

  test("falls back to '...' when task description missing", () => {
    expect(extractToolCommand("task", {})).toBe("agent: ...")
  })

  // Pattern-based fallbacks (generic behavior)
  test("extracts command field", () => {
    expect(extractToolCommand("bash", { command: "ls -la" })).toBe("ls -la")
  })

  test("extracts filePath with tool name prefix", () => {
    expect(extractToolCommand("read", { filePath: "/home/user/project/file.ts" })).toBe("read file.ts")
  })

  test("extracts filePath for write", () => {
    expect(extractToolCommand("write", { filePath: "/home/user/project/file.ts" })).toBe("write file.ts")
  })

  test("extracts filePath for edit", () => {
    expect(extractToolCommand("edit", { filePath: "/home/user/project/file.ts" })).toBe("edit file.ts")
  })

  test("extracts pattern with tool name prefix", () => {
    expect(extractToolCommand("glob", { pattern: "**/*.ts" })).toBe("glob **/*.ts")
  })

  test("extracts url with tool name prefix", () => {
    expect(extractToolCommand("webfetch", { url: "https://example.com" })).toBe("webfetch https://example.com")
  })

  test("extracts title field", () => {
    expect(extractToolCommand("custom", { title: "Custom action" })).toBe("Custom action")
  })

  test("extracts description with tool name prefix", () => {
    expect(extractToolCommand("custom", { description: "Do something" })).toBe("custom: Do something")
  })

  test("falls back to tool name when no known fields", () => {
    expect(extractToolCommand("custom", {})).toBe("custom")
  })

  test("falls back to tool name for bash with no command", () => {
    expect(extractToolCommand("bash", {})).toBe("bash")
  })

  // Generic unknown tools
  test("handles unknown tool with command", () => {
    expect(extractToolCommand("mcp_tool", { command: "do something" })).toBe("do something")
  })

  test("handles unknown tool with filePath", () => {
    expect(extractToolCommand("mcp_tool", { filePath: "/path/to/file.txt" })).toBe("mcp_tool file.txt")
  })

  test("handles unknown tool with pattern", () => {
    expect(extractToolCommand("mcp_tool", { pattern: "*.ts" })).toBe("mcp_tool *.ts")
  })

  test("handles unknown tool with url", () => {
    expect(extractToolCommand("mcp_tool", { url: "https://example.com" })).toBe("mcp_tool https://example.com")
  })

  // Truncation
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
