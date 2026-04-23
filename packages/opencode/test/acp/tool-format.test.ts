import { describe, expect, it } from "bun:test"
import { isAbsolute, resolve } from "path"
import {
  permissionDisplayInfo,
  toolCallFromPart as _toolCallFromPart,
  toolResultFromPart as _toolResultFromPart,
} from "../../src/acp/tool-format"

const CWD = process.cwd()
const toolCallFromPart = (tool: string, input: Record<string, unknown>, cwd: string = CWD) =>
  _toolCallFromPart(tool, input, cwd)
const toolResultFromPart = (
  tool: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
  cwd: string = CWD,
) => _toolResultFromPart(tool, input, output, isError, cwd)

describe("toolCallFromPart", () => {
  describe("bash", () => {
    it("formats bash command with description and workdir location", () => {
      const result = toolCallFromPart("bash", { command: "ls -la", description: "List files", workdir: "/home" })
      expect(result.title).toBe("List files")
      expect(result.kind).toBe("other")
      expect(result.locations).toEqual([{ path: "/home" }])
      expect(result.rawInput).toEqual({ command: "ls -la", description: "List files", workdir: "/home" })
    })

    it("falls back to command when no description", () => {
      const result = toolCallFromPart("bash", { command: "npm install" })
      expect(result.title).toBe("npm install")
    })

    it("normalizes mcp__acp__ prefix", () => {
      const result = toolCallFromPart("mcp__acp__bash", { command: "echo hi" })
      expect(result.title).toBe("echo hi")
    })

    it("falls back to session cwd in locations and rawInput when workdir is absent", () => {
      const cwd = resolve("/workspace/project")
      const result = toolCallFromPart("bash", { command: "ls" }, cwd)
      expect(result.locations).toEqual([{ path: cwd }])
      expect(result.rawInput).toEqual({ command: "ls", cwd })
    })

    it("does not inject cwd into rawInput when workdir is provided", () => {
      const result = toolCallFromPart("bash", { command: "ls", workdir: "/opt" }, resolve("/workspace"))
      expect(result.rawInput).toEqual({ command: "ls", workdir: "/opt" })
    })
  })

  describe("read", () => {
    it("formats read with file path", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts" })
      expect(result.title).toBe("Read /src/index.ts")
      expect(result.kind).toBe("read")
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
    })

    it("uses 1-based line numbers when offset is provided (matches read tool contract)", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10 })
      expect(result.locations).toEqual([{ path: "/src/index.ts", line: 10 }])
    })

    it("omits line key when offset is zero", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 0 })
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
    })

    it("omits line key when offset is 1 (redundant with default)", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 1 })
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
      expect(result.title).toBe("Read /src/index.ts")
    })

    it("includes line range suffix", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10, limit: 20 })
      expect(result.title).toBe("Read /src/index.ts (10 - 29)")
    })

    it("clamps range start to 1 when only limit is given", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", limit: 20 })
      expect(result.title).toBe("Read /src/index.ts (1 - 20)")
    })

    it("ignores non-finite offset and limit values", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: NaN, limit: Infinity })
      expect(result.title).toBe("Read /src/index.ts")
      expect(result.locations).toEqual([{ path: "/src/index.ts" }])
    })

    it("includes from-line suffix", () => {
      const result = toolCallFromPart("read", { filePath: "/src/index.ts", offset: 10 })
      expect(result.title).toBe("Read /src/index.ts (from line 10)")
    })

    it("falls back when no file path", () => {
      const result = toolCallFromPart("read", {})
      expect(result.title).toBe("Read File")
      expect(result.locations).toEqual([])
    })
  })

  describe("edit", () => {
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
      const result = toolCallFromPart("edit", { oldString: "a", newString: "b" })
      expect(result.title).toBe("Edit")
      expect(result.content).toEqual([])
    })
  })

  describe("write", () => {
    it("formats write with diff content (null oldText)", () => {
      const result = toolCallFromPart("write", { filePath: "/new.ts", content: "hello" })
      expect(result.title).toBe("Write /new.ts")
      expect(result.kind).toBe("edit")
      expect(result.content).toEqual([{ type: "diff", path: "/new.ts", oldText: null, newText: "hello" }])
    })
  })

  describe("glob", () => {
    it("formats glob with path and pattern", () => {
      const result = toolCallFromPart("glob", { path: "/src", pattern: "*.ts" })
      expect(result.title).toBe("Find `/src` `*.ts`")
      expect(result.kind).toBe("search")
    })

    it("absolutizes relative paths", () => {
      const result = toolCallFromPart("glob", { path: "src", pattern: "*.ts" })
      expect(isAbsolute(result.locations[0].path)).toBe(true)
    })

    it("handles no path or pattern", () => {
      const result = toolCallFromPart("glob", {})
      expect(result.title).toBe("Find")
    })
  })

  describe("grep", () => {
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

  describe("webfetch", () => {
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
  describe("bash", () => {
    it("returns stdout for success wrapped in shell code fence", () => {
      const result = toolResultFromPart("bash", { command: "ls" }, "file1\nfile2", false)
      expect(result.rawOutput).toEqual({ stdout: "file1\nfile2" })
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: "content",
        content: { type: "text", text: "```sh\nfile1\nfile2\n```" },
      })
    })

    it("returns stderr for error", () => {
      const result = toolResultFromPart("bash", { command: "bad" }, "command not found", true)
      expect(result.rawOutput).toEqual({ stderr: "command not found" })
    })
  })

  describe("edit", () => {
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

    it("skips diff content on error and returns stderr", () => {
      const result = toolResultFromPart(
        "edit",
        { filePath: "/src/app.ts", oldString: "foo", newString: "bar" },
        "old_string not found",
        true,
      )
      expect(result.content).toHaveLength(1)
      expect(result.rawOutput).toEqual({ stderr: "old_string not found" })
    })
  })

  describe("write", () => {
    it("includes diff content with null oldText on success", () => {
      const result = toolResultFromPart("write", { filePath: "/new.ts", content: "hello" }, "Created", false)
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: "diff", path: "/new.ts", oldText: null, newText: "hello" })
    })

    it("skips diff on error and returns stderr", () => {
      const result = toolResultFromPart("write", { filePath: "/new.ts", content: "hello" }, "Permission denied", true)
      expect(result.content).toHaveLength(1)
      expect(result.rawOutput).toEqual({ stderr: "Permission denied" })
    })
  })

  describe("apply_patch", () => {
    it("returns only a diff-fenced patch block on success (title=output dedupes body)", () => {
      const patchText = "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new"
      const result = toolResultFromPart("apply_patch", { patchText }, "Patched", false)
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: "content",
        content: { type: "text", text: "```diff\n" + patchText + "\n```" },
      })
      expect(result.rawOutput).toEqual({ stdout: "Patched" })
    })

    it("returns empty content when patchText is absent on success", () => {
      const result = toolResultFromPart("apply_patch", {}, "Patched", false)
      expect(result.content).toHaveLength(0)
      expect(result.rawOutput).toEqual({ stdout: "Patched" })
    })

    it("keeps fenced error text and returns stderr on error", () => {
      const result = toolResultFromPart("apply_patch", { patchText: "bad" }, "Failed", true)
      expect(result.content).toHaveLength(1)
      const text = (result.content[0] as any).content.text
      expect(text).toMatch(/^```\n/)
      expect(text).toContain("Failed")
      expect(result.rawOutput).toEqual({ stderr: "Failed" })
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

describe("apply_patch canonical field", () => {
  it("reads patchText from call input and emits content block", () => {
    const patchText = "--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-x\n+y"
    const call = toolCallFromPart("apply_patch", { patchText })
    expect(call.title).toBe("Apply Patch")
    expect(call.kind).toBe("edit")
    expect(call.content).toEqual([{ type: "content", content: { type: "text", text: patchText } }])
  })

  it("produces empty content when patchText is absent", () => {
    const call = toolCallFromPart("apply_patch", {})
    expect(call.content).toEqual([])
  })
})

describe("path resolution against cwd", () => {
  it("resolves relative filePath against the passed cwd (not process.cwd)", () => {
    const cwd = resolve("/workspace/project")
    const result = toolCallFromPart("read", { filePath: "src/index.ts" }, cwd)
    expect(result.locations).toEqual([{ path: resolve(cwd, "src/index.ts") }])
  })

  it("leaves absolute paths untouched", () => {
    const absolutePath = resolve("/abs/path.ts")
    const result = toolCallFromPart("read", { filePath: absolutePath }, resolve("/workspace/project"))
    expect(result.locations).toEqual([{ path: absolutePath }])
  })

  it("resolves relative path in edit result content", () => {
    const cwd = resolve("/workspace")
    const result = toolResultFromPart(
      "edit",
      { filePath: "rel/file.ts", oldString: "a", newString: "b" },
      "ok",
      false,
      cwd,
    )
    expect(result.content[1]).toEqual({
      type: "diff",
      path: resolve(cwd, "rel/file.ts"),
      oldText: "a",
      newText: "b",
    })
  })

  it("resolves relative bash workdir against cwd", () => {
    const cwd = resolve("/workspace")
    const result = toolCallFromPart("bash", { command: "ls", workdir: "rel" }, cwd)
    expect(result.locations).toEqual([{ path: resolve(cwd, "rel") }])
  })
})

describe("non-bash tool output fencing", () => {
  it("fences opencode-style MCP tool output (exa_web_search_exa, no mcp__ prefix) to prevent markdown injection", () => {
    const output = "# Title\nsome result\n## Section\ncontent"
    const result = toolResultFromPart("exa_web_search_exa", {}, output, false)
    const text = (result.content[0] as any).content.text
    expect(text).toMatch(/^```\n/)
    expect(text).toContain(output)
    expect(text).toMatch(/```$/)
    expect(result.rawOutput).toEqual({ stdout: output })
  })

  it("fences default-branch success output (grep/webfetch/todowrite/unknown) in a plain code block", () => {
    for (const tool of ["grep", "webfetch", "todowrite", "codesearch", "unknownTool"]) {
      const result = toolResultFromPart(tool, {}, "plain text", false)
      const text = (result.content[0] as any).content.text
      expect(text).toMatch(/^```\n/)
      expect(text).toContain("plain text")
      expect(text).toMatch(/\n```$/)
    }
  })

  it("drops content on read/list success (title + locations already carry the UX) but preserves rawOutput", () => {
    for (const tool of ["read", "list"]) {
      const result = toolResultFromPart(tool, {}, "plain text", false)
      expect(result.content).toEqual([])
      // unparseable wrapper → falls back to stdout
      expect(result.rawOutput).toEqual({ stdout: "plain text" })
    }
  })

  it("fences read/list error output so the user sees why it failed", () => {
    for (const tool of ["read", "list"]) {
      const result = toolResultFromPart(tool, { filePath: "/missing" }, "ENOENT: no such file", true)
      const text = (result.content[0] as any).content.text
      expect(text).toMatch(/^```\n/)
      expect(text).toContain("ENOENT: no such file")
      expect(text).toMatch(/\n```$/)
      expect(result.rawOutput).toEqual({ stderr: "ENOENT: no such file" })
    }
  })

  it("parses read file wrapper into structured rawOutput with end footer", () => {
    const output =
      "<path>/src/a.ts</path>\n<type>file</type>\n<content>\n1: line one\n2: line two\n\n(End of file - total 2 lines)\n</content>"
    const result = toolResultFromPart("read", { filePath: "/src/a.ts" }, output, false)
    expect(result.content).toEqual([])
    expect(result.rawOutput).toEqual({
      path: "/src/a.ts",
      type: "file",
      content: "1: line one\n2: line two",
      truncation: { kind: "end", total: 2 },
    })
  })

  it("parses read file wrapper with 'more' truncation footer", () => {
    const output =
      "<path>/src/big.ts</path>\n<type>file</type>\n<content>\n1: a\n2: b\n\n(Showing lines 1-2 of 500. Use offset=3 to continue.)\n</content>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src/big.ts",
      type: "file",
      content: "1: a\n2: b",
      truncation: { kind: "more", from: 1, to: 2, total: 500, next: 3 },
    })
  })

  it("parses read file wrapper with 'cut' truncation footer", () => {
    const output =
      "<path>/src/huge.bin</path>\n<type>file</type>\n<content>\n1: a\n2: b\n\n(Output capped at 256KB. Showing lines 1-2. Use offset=3 to continue.)\n</content>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src/huge.bin",
      type: "file",
      content: "1: a\n2: b",
      truncation: { kind: "cut", maxBytes: "256KB", from: 1, to: 2, next: 3 },
    })
  })

  it("parses read directory wrapper with full footer", () => {
    const output =
      "<path>/src</path>\n<type>directory</type>\n<entries>\na.ts\nb.ts\n(2 entries)\n</entries>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src",
      type: "directory",
      content: "a.ts\nb.ts",
      truncation: { kind: "dir_full", total: 2 },
    })
  })

  it("parses read directory wrapper with partial footer", () => {
    const output =
      "<path>/src</path>\n<type>directory</type>\n<entries>\na.ts\nb.ts\n(Showing 2 of 100 entries. Use 'offset' parameter to read beyond entry 2)\n</entries>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src",
      type: "directory",
      content: "a.ts\nb.ts",
      truncation: { kind: "dir_partial", shown: 2, total: 100, next: 2 },
    })
  })

  it("parses read wrapper with trailing system-reminder", () => {
    const output =
      "<path>/src/a.ts</path>\n<type>file</type>\n<content>\n1: x\n\n(End of file - total 1 lines)\n</content>\n\n<system-reminder>\nfollow project conventions\n</system-reminder>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src/a.ts",
      type: "file",
      content: "1: x",
      truncation: { kind: "end", total: 1 },
      systemReminder: "follow project conventions",
    })
  })

  it("tolerates literal </content> inside the file body via greedy extraction", () => {
    const inner = "1: prose mentioning </content> inline"
    const output =
      `<path>/src/md.md</path>\n<type>file</type>\n<content>\n${inner}\n\n(End of file - total 1 lines)\n</content>`
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({
      path: "/src/md.md",
      type: "file",
      content: inner,
      truncation: { kind: "end", total: 1 },
    })
  })

  it("falls back to stdout on malformed wrapper (unexpected tail)", () => {
    const output =
      "<path>/src/a.ts</path>\n<type>file</type>\n<content>\n1: x\n</content>\nunexpected trailing text"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({ stdout: output })
  })

  it("falls back to stdout when envelope does not match", () => {
    const output = "<path>/src/a.ts</path><type>file</type>\n<content>\nmissing newline\n</content>"
    const result = toolResultFromPart("read", {}, output, false)
    expect(result.rawOutput).toEqual({ stdout: output })
  })

  it("parses skill wrapper with files into structured rawOutput", () => {
    const output = [
      '<skill_content name="Frontend">',
      "# Skill: Frontend",
      "",
      "Do UI things.",
      "",
      "Base directory for this skill: file:///skills/frontend",
      "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
      "Note: file list is sampled.",
      "",
      "<skill_files>",
      "<file>/skills/frontend/scripts/build.sh</file>",
      "<file>/skills/frontend/reference/guide.md</file>",
      "</skill_files>",
      "</skill_content>",
    ].join("\n")
    const result = toolResultFromPart("skill", {}, output, false)
    expect(result.content).toEqual([])
    expect(result.rawOutput).toEqual({
      name: "Frontend",
      markdown: "Do UI things.",
      baseDir: "file:///skills/frontend",
      files: ["/skills/frontend/scripts/build.sh", "/skills/frontend/reference/guide.md"],
    })
  })

  it("parses skill wrapper with empty files list", () => {
    const output = [
      '<skill_content name="Bare">',
      "# Skill: Bare",
      "",
      "body",
      "",
      "Base directory for this skill: file:///skills/bare",
      "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
      "Note: file list is sampled.",
      "",
      "<skill_files>",
      "",
      "</skill_files>",
      "</skill_content>",
    ].join("\n")
    const result = toolResultFromPart("skill", {}, output, false)
    expect(result.rawOutput).toEqual({
      name: "Bare",
      markdown: "body",
      baseDir: "file:///skills/bare",
      files: [],
    })
  })

  it("parses skill wrapper with multi-paragraph markdown body", () => {
    const output = [
      '<skill_content name="Deep">',
      "# Skill: Deep",
      "",
      "Para one.",
      "",
      "Para two with `code`.",
      "",
      "Base directory for this skill: file:///x",
      "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
      "Note: file list is sampled.",
      "",
      "<skill_files>",
      "",
      "</skill_files>",
      "</skill_content>",
    ].join("\n")
    const result = toolResultFromPart("skill", {}, output, false)
    expect((result.rawOutput as any).markdown).toBe("Para one.\n\nPara two with `code`.")
  })

  it("falls back to stdout on malformed skill wrapper", () => {
    const output = '<skill_content name="X">\n# Skill: X\n\nbroken — no closing tag'
    const result = toolResultFromPart("skill", {}, output, false)
    expect(result.rawOutput).toEqual({ stdout: output })
  })

  it("fences skill error output so the user sees why it failed", () => {
    const output = 'Skill "Missing" not found. Available skills: Frontend'
    const result = toolResultFromPart("skill", {}, output, true)
    const text = (result.content[0] as any).content.text
    expect(text).toContain(output)
    expect(result.rawOutput).toEqual({ stderr: output })
  })

  it("parses task wrapper into structured rawOutput", () => {
    const output = [
      "task_id: ses_abc123 (for resuming to continue this task if needed)",
      "",
      "<task_result>",
      "Investigation complete. Found 3 issues in auth.ts.",
      "</task_result>",
    ].join("\n")
    const result = toolResultFromPart("task", { description: "investigate auth" }, output, false)
    expect(result.content).toEqual([])
    expect(result.rawOutput).toEqual({
      taskId: "ses_abc123",
      result: "Investigation complete. Found 3 issues in auth.ts.",
    })
  })

  it("parses task wrapper with multiline result preserving internal newlines", () => {
    const output = [
      "task_id: ses_xyz (for resuming to continue this task if needed)",
      "",
      "<task_result>",
      "Line one",
      "",
      "Line three",
      "</task_result>",
    ].join("\n")
    const result = toolResultFromPart("task", {}, output, false)
    expect((result.rawOutput as any).result).toBe("Line one\n\nLine three")
  })

  it("parses task wrapper with empty result", () => {
    const output = [
      "task_id: ses_empty (for resuming to continue this task if needed)",
      "",
      "<task_result>",
      "",
      "</task_result>",
    ].join("\n")
    const result = toolResultFromPart("task", {}, output, false)
    expect(result.rawOutput).toEqual({ taskId: "ses_empty", result: "" })
  })

  it("falls back to stdout on malformed task wrapper", () => {
    const output = "no task_id prefix\n<task_result>\nhi\n</task_result>"
    const result = toolResultFromPart("task", {}, output, false)
    expect(result.rawOutput).toEqual({ stdout: output })
  })

  it("fences task error output so the user sees why it failed", () => {
    const output = "Task aborted by user"
    const result = toolResultFromPart("task", {}, output, true)
    const text = (result.content[0] as any).content.text
    expect(text).toContain(output)
    expect(result.rawOutput).toEqual({ stderr: output })
  })

  it("preserves widened fence when output contains triple-backticks", () => {
    const output = "before\n```\nnested\n```\nafter"
    const result = toolResultFromPart("unknown", {}, output, false)
    const text = (result.content[0] as any).content.text
    expect(text.startsWith("````\n")).toBe(true)
    expect(text.endsWith("\n````")).toBe(true)
  })
})

describe("permissionDisplayInfo", () => {
  it("formats edit permission from lowercase metadata keys", () => {
    const info = permissionDisplayInfo(
      "edit",
      { filepath: "/abs/foo.ts", diff: "--- a\n+++ b\n" },
      CWD,
    )
    expect(info.title).toBe("Edit /abs/foo.ts")
    expect(info.kind).toBe("edit")
    expect(info.locations).toEqual([{ path: "/abs/foo.ts" }])
    expect(info.content).toHaveLength(1)
  })

  it("formats bash permission with description fallback", () => {
    const info = permissionDisplayInfo("bash", { command: "rm -rf /", description: "Nuke" }, CWD)
    expect(info.title).toBe("Nuke")
    expect(info.kind).toBe("execute")
  })

  it("formats webfetch permission", () => {
    const info = permissionDisplayInfo("webfetch", { url: "https://example.com" }, CWD)
    expect(info.title).toBe("Fetch https://example.com")
    expect(info.kind).toBe("fetch")
  })

  it("falls back to permission name on unknown type", () => {
    const info = permissionDisplayInfo("doom_loop", {}, CWD)
    expect(info.title).toBe("doom_loop")
    expect(info.kind).toBe("other")
  })

  it("resolves relative edit filepath against cwd", () => {
    const cwd = resolve("/ws")
    const info = permissionDisplayInfo("edit", { filepath: "rel/foo.ts" }, cwd)
    expect(info.locations).toEqual([{ path: resolve(cwd, "rel/foo.ts") }])
  })
})
