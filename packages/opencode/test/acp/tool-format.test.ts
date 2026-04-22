import { describe, expect, it } from "bun:test"
import { toolCallFromPart, toolResultFromPart } from "../../src/acp/tool-format"

describe("toolCallFromPart", () => {
  describe("bash/shell/terminal", () => {
    it("formats bash command with description", () => {
      const result = toolCallFromPart("bash", { command: "ls -la", description: "List files", cwd: "/home" })
      expect(result.title).toBe("List files")
      expect(result.kind).toBe("other")
      expect(result.locations).toEqual([{ path: "/home" }])
      expect(result.rawInput).toEqual({ command: "ls -la", description: "List files", cwd: "/home" })
    })

    it("falls back to command when no description", () => {
      const result = toolCallFromPart("shell", { command: "npm install" })
      expect(result.title).toBe("npm install")
    })

    it("normalizes mcp__acp__ prefix", () => {
      const result = toolCallFromPart("mcp__acp__bash", { command: "echo hi" })
      expect(result.title).toBe("echo hi")
    })
  })

  describe("bashoutput", () => {
    it("returns Tail Logs title", () => {
      const result = toolCallFromPart("bashoutput", {})
      expect(result.title).toBe("Tail Logs")
      expect(result.kind).toBe("execute")
    })
  })

  describe("read/view", () => {
    it("formats read with file path", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts" })
      expect(result.title).toBe("Read /src/index.ts")
      expect(result.kind).toBe("read")
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
    })

    it("uses 1-based line numbers when offset is provided", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10 })
      expect(result.locations).toEqual([{ path: "/src/index.ts", line: 11 }])
    })

    it("omits line key when offset is zero", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 0 })
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
    })

    it("includes line range suffix", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10, limit: 20 })
      expect(result.title).toBe("Read /src/index.ts (11 - 30)")
    })

    it("includes from-line suffix", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10 })
      expect(result.title).toBe("Read /src/index.ts (from line 11)")
    })

    it("falls back when no file path", () => {
      const result = toolCallFromPart("read", {})
      expect(result.title).toBe("Read File")
      expect(result.locations).toEqual([])
    })
  })

  describe("edit/str_replace", () => {
    it("formats edit with diff content", () => {
      const result = toolCallFromPart("edit", {
        filePath: "/src/app.ts",
        oldString: "foo",
        newString: "bar",
      })
      expect(result.title).toBe("Edit `/src/app.ts`")
      expect(result.kind).toBe("edit")
      expect(result.content).toEqual([{ type: "diff", path: "/src/app.ts", oldText: "foo", newText: "bar" }])
      expect(result.locations).toEqual([{ path: "/src/app.ts" }])
    })

    it("handles missing file path", () => {
      const result = toolCallFromPart("str_replace", { oldString: "a", newString: "b" })
      expect(result.title).toBe("Edit")
      expect(result.content).toEqual([])
    })
  })

  describe("write/create", () => {
    it("formats write with diff content (null oldText)", () => {
      const result = toolCallFromPart("write", { filePath: "/new.ts", content: "hello" })
      expect(result.title).toBe("Write /new.ts")
      expect(result.kind).toBe("edit")
      expect(result.content).toEqual([{ type: "diff", path: "/new.ts", oldText: null, newText: "hello" }])
    })
  })

  describe("glob/find", () => {
    it("formats glob with path and pattern", () => {
      const result = toolCallFromPart("glob", { path: "/src", pattern: "*.ts" })
      expect(result.title).toBe("Find `/src` `*.ts`")
      expect(result.kind).toBe("search")
    })

    it("absolutizes relative paths", () => {
      const result = toolCallFromPart("glob", { path: "src", pattern: "*.ts" })
      expect(result.locations[0].path.startsWith("/")).toBe(true)
    })

    it("handles no path or pattern", () => {
      const result = toolCallFromPart("find", {})
      expect(result.title).toBe("Find")
    })
  })

  describe("grep/search", () => {
    it("formats grep with pattern and path", () => {
      const result = toolCallFromPart("grep", { pattern: "TODO", path: "/src" })
      expect(result.title).toBe('grep "TODO" /src')
      expect(result.kind).toBe("search")
    })

    it("truncates long patterns", () => {
      const long = "a".repeat(50)
      const result = toolCallFromPart("grep", { pattern: long })
      expect(result.title.length).toBeLessThanOrEqual(40)
    })
  })

  describe("webfetch/fetch", () => {
    it("formats fetch with url", () => {
      const result = toolCallFromPart("webfetch", { url: "https://example.com", prompt: "get title" })
      expect(result.title).toBe("Fetch https://example.com")
      expect(result.kind).toBe("fetch")
      expect(result.content).toHaveLength(1)
    })
  })

  describe("websearch", () => {
    it("formats search with query", () => {
      const result = toolCallFromPart("websearch", { query: "bun test" })
      expect(result.title).toBe('"bun test"')
      expect(result.kind).toBe("fetch")
    })
  })

  describe("task", () => {
    it("formats task with description", () => {
      const result = toolCallFromPart("task", { description: "Research APIs", prompt: "find REST patterns" })
      expect(result.title).toBe("Research APIs")
      expect(result.kind).toBe("think")
      expect(result.content).toHaveLength(1)
    })
  })

  describe("plan mode", () => {
    it("emits switch_mode kind for plan_enter", () => {
      const result = toolCallFromPart("plan_enter", {})
      expect(result.title).toBe("Enter Plan Mode")
      expect(result.kind).toBe("switch_mode")
    })

    it("emits switch_mode kind for plan_exit", () => {
      const result = toolCallFromPart("plan_exit", {})
      expect(result.title).toBe("Exit Plan Mode")
      expect(result.kind).toBe("switch_mode")
    })
  })

  describe("bash kind pinning", () => {
    it("uses kind 'other' instead of spec 'execute' to avoid Zed blue run-box styling", () => {
      const result = toolCallFromPart("bash", { command: "ls", description: "List files" })
      expect(result.kind).toBe("other")
    })
  })

  describe("list", () => {
    it("uses read kind for directory listing", () => {
      const result = toolCallFromPart("list", { path: "/src" })
      expect(result.kind).toBe("read")
    })
  })

  describe("default", () => {
    it("falls back to tool name for unknown tools", () => {
      const result = toolCallFromPart("unknownTool", {})
      expect(result.title).toBe("unknownTool")
      expect(result.kind).toBe("other")
    })

    it("uses description if available", () => {
      const result = toolCallFromPart("custom", { description: "Custom action" })
      expect(result.title).toBe("Custom action")
    })
  })
})

describe("toolResultFromPart", () => {
  describe("bash/shell/terminal", () => {
    it("returns stdout for success", () => {
      const result = toolResultFromPart("bash", { command: "ls" }, "file1\nfile2", false)
      expect(result.rawOutput).toEqual({ stdout: "file1\nfile2" })
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({ type: "content", content: { type: "text", text: "file1\nfile2" } })
    })

    it("returns stderr for error", () => {
      const result = toolResultFromPart("shell", { command: "bad" }, "command not found", true)
      expect(result.rawOutput).toEqual({ stderr: "command not found" })
    })
  })

  describe("edit/str_replace", () => {
    it("includes diff content on success", () => {
      const result = toolResultFromPart(
        "edit",
        { filePath: "/src/app.ts", oldString: "foo", newString: "bar" },
        "Applied edit",
        false,
      )
      expect(result.rawOutput).toEqual({ stdout: "Applied edit" })
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: "diff", path: "/src/app.ts", oldText: "foo", newText: "bar" })
    })

    it("skips diff content on error", () => {
      const result = toolResultFromPart(
        "edit",
        { filePath: "/src/app.ts", oldString: "foo", newString: "bar" },
        "old_string not found",
        true,
      )
      expect(result.content).toHaveLength(1)
    })
  })

  describe("write/create", () => {
    it("includes diff content with null oldText on success", () => {
      const result = toolResultFromPart("write", { filePath: "/new.ts", content: "hello" }, "Created", false)
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: "diff", path: "/new.ts", oldText: null, newText: "hello" })
    })

    it("skips diff on error", () => {
      const result = toolResultFromPart("write", { filePath: "/new.ts", content: "hello" }, "Permission denied", true)
      expect(result.content).toHaveLength(1)
    })
  })

  describe("patch/apply_patch", () => {
    it("includes patch text content on success", () => {
      const patch = "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new"
      const result = toolResultFromPart("patch", { filePath: "/file", diff: patch }, "Patched", false)
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: "content", content: { type: "text", text: patch } })
    })

    it("skips patch content on error", () => {
      const result = toolResultFromPart("apply_patch", { filePath: "/file", diff: "bad" }, "Failed", true)
      expect(result.content).toHaveLength(1)
    })
  })

  describe("default", () => {
    it("returns stdout for success", () => {
      const result = toolResultFromPart("unknown", {}, "some output", false)
      expect(result.rawOutput).toEqual({ stdout: "some output" })
      expect(result.content).toHaveLength(1)
    })

    it("returns stderr for error", () => {
      const result = toolResultFromPart("unknown", {}, "error msg", true)
      expect(result.rawOutput).toEqual({ stderr: "error msg" })
    })

    it("wraps error output in markdown fence", () => {
      const result = toolResultFromPart("unknown", {}, "some error", true)
      const text = (result.content[0] as any).content.text
      expect(text).toContain("```")
      expect(text).toContain("some error")
    })
  })
})
