import { describe, expect, test } from "bun:test"
import { isCustomHookTool, normalizeTool } from "./tool-meta"

describe("tool-meta normalizeTool", () => {
  test("maps supported external tool aliases to built-in renderers", () => {
    expect(normalizeTool("terminal")).toBe("bash")
    expect(normalizeTool("read_file")).toBe("read")
    expect(normalizeTool("web_search")).toBe("websearch")
  })

  test("leaves unsupported aliases alone", () => {
    expect(normalizeTool("write_file")).toBe("write_file")
    expect(normalizeTool("web_extract")).toBe("web_extract")
    expect(normalizeTool("patch")).toBe("patch")
  })
})

describe("tool-meta isCustomHookTool", () => {
  test("treats hook-like bash parts as custom hooks", () => {
    expect(
      isCustomHookTool(
        "bash",
        { description: "before session-start hook" },
        { hook_name: "session-start", hook_type: "before" },
      ),
    ).toBe(true)
  })

  test("does not hide ordinary external tools like hermes search_files", () => {
    expect(isCustomHookTool("search_files", { pattern: "apps" }, {})).toBe(false)
    expect(isCustomHookTool("terminal", { command: "date" }, {})).toBe(false)
  })
})
