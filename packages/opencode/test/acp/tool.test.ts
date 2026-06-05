import { describe, expect, test } from "bun:test"
import {
  completedToolUpdate,
  completedToolContent,
  completedToolRawOutput,
  errorToolUpdate,
  extractImageAttachments,
  imageContents,
  runningToolUpdate,
  shellOutputSnapshot,
  toLocations,
  toToolKind,
} from "../../src/acp/tool"

describe("acp tool conversion", () => {
  test("maps OpenCode tool ids to ACP tool kinds", () => {
    expect(toToolKind("bash")).toBe("execute")
    expect(toToolKind("shell")).toBe("execute")
    expect(toToolKind("webfetch")).toBe("fetch")
    expect(toToolKind("edit")).toBe("edit")
    expect(toToolKind("apply_patch")).toBe("edit")
    expect(toToolKind("patch")).toBe("edit")
    expect(toToolKind("write")).toBe("edit")
    expect(toToolKind("grep")).toBe("search")
    expect(toToolKind("glob")).toBe("search")
    expect(toToolKind("context7_resolve_library_id")).toBe("search")
    expect(toToolKind("context7_get_library_docs")).toBe("search")
    expect(toToolKind("read")).toBe("read")
    expect(toToolKind("task")).toBe("think")
    expect(toToolKind("custom_tool")).toBe("other")
  })

  test("extracts file locations from tool input", () => {
    expect(toLocations("read", { filePath: "/tmp/a.ts" })).toEqual([{ path: "/tmp/a.ts" }])
    expect(toLocations("edit", { filePath: "/tmp/b.ts" })).toEqual([{ path: "/tmp/b.ts" }])
    expect(toLocations("write", { filePath: "/tmp/c.ts" })).toEqual([{ path: "/tmp/c.ts" }])
    expect(toLocations("grep", { path: "/repo/src" })).toEqual([{ path: "/repo/src" }])
    expect(toLocations("glob", { path: "/repo/test" })).toEqual([{ path: "/repo/test" }])
    expect(toLocations("context7_get_library_docs", { path: "/docs" })).toEqual([{ path: "/docs" }])
    expect(toLocations("external_directory", { directories: ["/tmp/outside"], patterns: ["/tmp/outside/*"] })).toEqual([
      { path: "/tmp/outside" },
    ])
    expect(toLocations("bash", { filePath: "/tmp/nope.ts", path: "/tmp" })).toEqual([])
    expect(toLocations("read", { path: "/tmp/missing-file-path.ts" })).toEqual([])
  })

  test("builds completed content with text, edit diffs, and image attachments", () => {
    const image = Buffer.from("image-data").toString("base64")

    expect(
      completedToolContent("edit", {
        status: "completed",
        input: {
          filePath: "/tmp/file.ts",
          oldString: "before",
          newString: "after",
        },
        output: "edited /tmp/file.ts",
        attachments: [
          {
            type: "file",
            mime: "image/png",
            filename: "image.png",
            url: `data:image/png;base64,${image}`,
          },
          {
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,bm90ZQ==",
          },
        ],
      }),
    ).toEqual([
      {
        type: "content",
        content: { type: "text", text: "edited /tmp/file.ts" },
      },
      {
        type: "diff",
        path: "/tmp/file.ts",
        oldText: "before",
        newText: "after",
      },
      {
        type: "content",
        content: { type: "image", mimeType: "image/png", data: image },
      },
    ])
  })

  test("omits edit diffs until old and new text fields exist", () => {
    expect(
      completedToolContent("write", {
        status: "completed",
        input: {
          filePath: "/tmp/file.ts",
          content: "created",
        },
        output: "wrote /tmp/file.ts",
      }),
    ).toEqual([
      {
        type: "content",
        content: { type: "text", text: "wrote /tmp/file.ts" },
      },
    ])
  })

  test("uses clean read display text for completed content", () => {
    const output = [
      "<path>/tmp/file.ts</path>",
      "<type>file</type>",
      "<content>",
      "7: first",
      "8: second",
      "",
      "(End of file - total 8 lines)",
      "</content>",
    ].join("\n")
    const state = {
      status: "completed" as const,
      input: { filePath: "/tmp/file.ts" },
      output,
      metadata: {
        display: {
          type: "file",
          path: "/tmp/file.ts",
          text: "first\nsecond",
          lineStart: 7,
          lineEnd: 8,
          totalLines: 8,
          truncated: false,
        },
      },
    }

    expect(completedToolContent("read", state)).toEqual([
      {
        type: "content",
        content: { type: "text", text: "first\nsecond" },
      },
    ])
    expect(completedToolRawOutput(state)).toEqual({
      output,
      metadata: state.metadata,
    })
  })

  test("builds completed raw output with optional metadata and attachments", () => {
    const attachments = [
      {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: "data:image/jpeg;base64,AAAA",
      },
    ]

    expect(
      completedToolRawOutput({
        status: "completed",
        input: {},
        output: "done",
        metadata: { exit: 0 },
        attachments,
      }),
    ).toEqual({
      output: "done",
      metadata: { exit: 0 },
      attachments,
    })

    expect(
      completedToolRawOutput({
        status: "completed",
        input: {},
        output: "done",
      }),
    ).toEqual({ output: "done" })
  })

  test("extracts image attachments only from data URLs", () => {
    const attachments = [
      {
        mime: "image/webp",
        url: "data:image/webp;charset=utf-8;base64,AAAA",
      },
      {
        mime: "image/png",
        url: "https://example.com/image.png",
      },
      {
        mime: "text/plain",
        url: "data:text/plain;base64,BBBB",
      },
    ]

    expect(extractImageAttachments(attachments)).toEqual([{ mimeType: "image/webp", data: "AAAA" }])
    expect(imageContents(attachments)).toEqual([
      {
        type: "content",
        content: { type: "image", mimeType: "image/webp", data: "AAAA" },
      },
    ])
  })

  test("reads shell output snapshot from string metadata output", () => {
    expect(shellOutputSnapshot({ metadata: { output: "line 1\nline 2" } })).toBe("line 1\nline 2")
    expect(shellOutputSnapshot({ metadata: { output: 42 } })).toBeUndefined()
    expect(shellOutputSnapshot({ metadata: undefined })).toBeUndefined()
  })

  test("embeds ACP terminal content for shell tools with terminal metadata", () => {
    expect(
      runningToolUpdate({
        toolCallId: "call_terminal",
        toolName: "bash",
        state: {
          status: "running",
          input: { command: "npm test" },
          metadata: { terminalId: "term_1", output: "" },
        },
      }).content,
    ).toEqual([{ type: "terminal", terminalId: "term_1" }])

    expect(
      completedToolContent("bash", {
        status: "completed",
        input: { command: "npm test" },
        output: "passed",
        metadata: { terminalId: "term_1" },
      }),
    ).toEqual([{ type: "terminal", terminalId: "term_1" }])
  })

  test("uses shell command instead of description for execute tool titles", () => {
    expect(
      runningToolUpdate({
        toolCallId: "call_1",
        toolName: "bash",
        state: {
          status: "running",
          input: {
            command: "git show --stat",
            description: "Shows latest commit file statistics",
          },
        },
      }).title,
    ).toBe("git show --stat")

    expect(
      completedToolUpdate({
        toolCallId: "call_2",
        toolName: "bash",
        state: {
          status: "completed",
          input: {
            command: "git show --name-only",
            description: "Shows latest commit changed files",
          },
          output: "README.md",
          title: "Shows latest commit changed files",
        },
      }).title,
    ).toBe("git show --name-only")

    expect(
      errorToolUpdate({
        toolCallId: "call_3",
        toolName: "bash",
        state: {
          status: "error",
          input: {
            command: "git show --summary",
            description: "Shows latest commit summary",
          },
          error: "failed",
        },
      }).title,
    ).toBe("git show --summary")
  })

  test("falls back to existing execute tool title when command is missing", () => {
    expect(
      runningToolUpdate({
        toolCallId: "call_1",
        toolName: "bash",
        state: {
          status: "running",
          input: {
            description: "Shows latest commit summary",
          },
          title: "Shows latest commit summary",
        },
      }).title,
    ).toBe("Shows latest commit summary")

    expect(
      errorToolUpdate({
        toolCallId: "call_2",
        toolName: "bash",
        state: {
          status: "error",
          input: {
            description: "Shows latest commit summary",
          },
          error: "failed",
        },
      }).title,
    ).toBe("bash")
  })
})
