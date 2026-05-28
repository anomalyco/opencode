import { describe, expect, test } from "bun:test"
import {
  completedToolContent,
  completedToolRawOutput,
  extractImageAttachments,
  imageContents,
  shellOutputSnapshot,
  toLocations,
  toToolKind,
} from "../../src/acp-next/tool"

describe("acp-next tool conversion", () => {
  test("maps OpenCode tool ids to ACP tool kinds", () => {
    expect(toToolKind("bash")).toBe("execute")
    expect(toToolKind("shell")).toBe("execute")
    expect(toToolKind("webfetch")).toBe("fetch")
    expect(toToolKind("edit")).toBe("edit")
    expect(toToolKind("patch")).toBe("edit")
    expect(toToolKind("write")).toBe("edit")
    expect(toToolKind("grep")).toBe("search")
    expect(toToolKind("glob")).toBe("search")
    expect(toToolKind("repo_clone")).toBe("search")
    expect(toToolKind("repo_overview")).toBe("search")
    expect(toToolKind("context7_resolve_library_id")).toBe("search")
    expect(toToolKind("context7_get_library_docs")).toBe("search")
    expect(toToolKind("read")).toBe("read")
    expect(toToolKind("custom_tool")).toBe("other")
  })

  test("extracts file locations from tool input", () => {
    expect(toLocations("read", { filePath: "/tmp/a.ts" })).toEqual([{ path: "/tmp/a.ts" }])
    expect(toLocations("edit", { filePath: "/tmp/b.ts" })).toEqual([{ path: "/tmp/b.ts" }])
    expect(toLocations("write", { filePath: "/tmp/c.ts" })).toEqual([{ path: "/tmp/c.ts" }])
    expect(toLocations("grep", { path: "/repo/src" })).toEqual([{ path: "/repo/src" }])
    expect(toLocations("glob", { path: "/repo/test" })).toEqual([{ path: "/repo/test" }])
    expect(toLocations("repo_clone", { path: "/repo" })).toEqual([{ path: "/repo" }])
    expect(toLocations("repo_overview", { path: "/repo" })).toEqual([{ path: "/repo" }])
    expect(toLocations("context7_get_library_docs", { path: "/docs" })).toEqual([{ path: "/docs" }])
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
})
