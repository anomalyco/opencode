import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  completedToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  toLocations,
  toToolKind,
} from "../../src/acp/tool"

describe("acp tools", () => {
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
    expect(toLocations("bash", { cmd: "pwd" }, "/workspace")).toEqual([{ path: "/workspace" }])
    expect(toLocations("bash", { command: "pwd", workdir: "subdir" }, "/workspace")).toEqual([
      { path: resolve("/workspace", "subdir") },
    ])
    expect(toLocations("bash", { command: "pwd", workdir: "/abs/dir" }, "/workspace")).toEqual([{ path: "/abs/dir" }])
    expect(toLocations("bash", { command: "printf hello" })).toEqual([])
    expect(toLocations("read", { path: "/tmp/missing-file-path.ts" })).toEqual([])
  })

  test("builds completed content with text and image attachments", () => {
    const image = Buffer.from("image-data").toString("base64")

    expect(
      completedToolUpdate({
        toolCallId: "tool-1",
        toolName: "edit",
        input: {
          filePath: "/tmp/file.ts",
          oldString: "before",
          newString: "after",
        },
        content: [
          { type: "text", text: "edited /tmp/file.ts" },
          { type: "file", mime: "image/png", name: "image.png", uri: `data:image/png;base64,${image}` },
          { type: "file", mime: "text/plain", name: "note.txt", uri: "data:text/plain;base64,bm90ZQ==" },
        ],
        metadata: {},
      }).content,
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

  test("omits edit diffs when normalized content does not contain one", () => {
    expect(
      completedToolUpdate({
        toolCallId: "tool-1",
        toolName: "write",
        input: {
          filePath: "/tmp/file.ts",
          content: "created",
        },
        content: [{ type: "text", text: "wrote /tmp/file.ts" }],
        metadata: {},
      }).content,
    ).toEqual([
      {
        type: "content",
        content: { type: "text", text: "wrote /tmp/file.ts" },
      },
    ])
  })

  test("unwraps read's JSON page envelope instead of showing model-facing formatting", () => {
    expect(
      completedToolUpdate({
        toolCallId: "tool-read",
        toolName: "read",
        input: { path: "/tmp/file.ts" },
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { type: "text-page", content: "first\nsecond", mime: "text/plain", offset: 1, truncated: false },
              null,
              2,
            ),
          },
        ],
      }).content,
    ).toEqual([{ type: "content", content: { type: "text", text: "first\nsecond" } }])

    expect(
      completedToolUpdate({
        toolCallId: "tool-list",
        toolName: "read",
        input: { path: "/tmp" },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entries: [
                { path: "a.ts", type: "file" },
                { path: "src", type: "directory" },
              ],
            }),
          },
        ],
      }).content,
    ).toEqual([{ type: "content", content: { type: "text", text: "a.ts\nsrc" } }])
  })

  test("sends completed tool calls as partial updates", () => {
    expect(
      pendingToolCall({
        toolCallId: "tool-1",
        toolName: "edit",
        state: {
          input: {
            filePath: "/tmp/file.ts",
            oldString: "before",
            newString: "after",
          },
        },
      }),
    ).toMatchObject({
      toolCallId: "tool-1",
      status: "pending",
      kind: "edit",
      locations: [{ path: "/tmp/file.ts" }],
      rawInput: {
        filePath: "/tmp/file.ts",
        oldString: "before",
        newString: "after",
      },
    })

    expect(
      completedToolUpdate({
        toolCallId: "tool-1",
        toolName: "edit",
        input: {
          filePath: "/tmp/file.ts",
          oldString: "before",
          newString: "after",
        },
        content: [{ type: "text", text: "Edit applied successfully." }],
        metadata: { output: "Edit applied successfully." },
      }),
    ).toEqual({
      toolCallId: "tool-1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "Edit applied successfully." },
        },
        {
          type: "diff",
          path: "/tmp/file.ts",
          oldText: "before",
          newText: "after",
        },
      ],
      rawOutput: {
        metadata: { output: "Edit applied successfully." },
      },
    })
  })

  test("builds running tool updates with normalized content", () => {
    expect(
      runningToolUpdate({
        toolCallId: "call",
        toolName: "read",
        state: { input: { filePath: "/tmp/a" } },
        content: [{ type: "text", text: "done" }],
      }),
    ).toMatchObject({
      toolCallId: "call",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: "done" } }],
    })
  })

  test("builds completed raw output with optional metadata", () => {
    const attachments = [
      {
        type: "file",
        mime: "image/jpeg",
        name: "photo.jpg",
        uri: "data:image/jpeg;base64,AAAA",
      },
    ]

    expect(
      completedToolUpdate({
        toolCallId: "call",
        toolName: "read",
        input: {},
        content: [],
        metadata: { output: "done", metadata: { exit: 0 }, attachments },
      }).rawOutput,
    ).toEqual({
      metadata: { output: "done", metadata: { exit: 0 }, attachments },
    })

    expect(
      completedToolUpdate({
        toolCallId: "call",
        toolName: "read",
        input: {},
        content: [],
      }).rawOutput,
    ).toEqual({})
  })

  test("extracts image attachments only from data URLs", () => {
    expect(
      completedToolUpdate({
        toolCallId: "call",
        toolName: "read",
        input: {},
        content: [
          { type: "file", mime: "image/webp", uri: "data:image/webp;charset=utf-8;base64,AAAA" },
          { type: "file", mime: "image/png", uri: "https://example.com/image.png" },
          { type: "file", mime: "text/plain", uri: "data:text/plain;base64,BBBB" },
        ],
        metadata: {},
      }).content,
    ).toEqual([
      {
        type: "content",
        content: { type: "image", mimeType: "image/webp", data: "AAAA" },
      },
    ])
  })

  test("builds failed tool updates", () => {
    expect(
      errorToolUpdate({
        toolCallId: "call",
        toolName: "read",
        input: { filePath: "/tmp/a" },
        content: [{ type: "text", text: "partial output" }],
        metadata: { path: "/tmp/a" },
        error: "failed",
      }),
    ).toEqual({
      toolCallId: "call",
      status: "failed",
      kind: "read",
      title: "read",
      locations: [{ path: "/tmp/a" }],
      rawInput: { filePath: "/tmp/a" },
      content: [
        { type: "content", content: { type: "text", text: "partial output" } },
        { type: "content", content: { type: "text", text: "failed" } },
      ],
      rawOutput: { metadata: { path: "/tmp/a" }, error: "failed" },
    })
  })
})
