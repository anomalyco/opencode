import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import {
  currentToolError,
  currentToolImages,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "./current-tool-state"

const time = { created: 1 }

describe("current tool state", () => {
  test("decodes complete streaming input", () => {
    const tool = {
      type: "tool",
      id: "tool_streaming",
      name: "edit",
      state: { status: "streaming", input: '{"path":"src/session.ts"}' },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolInput(tool)).toEqual({ path: "src/session.ts" })
    expect(currentToolMetadata(tool)).toEqual({})
  })

  test("uses an empty input until streaming JSON is complete", () => {
    const tool = {
      type: "tool",
      id: "tool_partial",
      name: "edit",
      state: { status: "streaming", input: '{"path":' },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolInput(tool)).toEqual({})
  })

  test("preserves running input and metadata", () => {
    const input = { command: "bun test src/timeline" }
    const metadata = { background: true, output: "Running timeline tests..." }

    const tool = {
      type: "tool",
      id: "tool_running",
      name: "shell",
      state: { status: "running", input, metadata },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolInput(tool)).toBe(input)
    expect(currentToolMetadata(tool)).toBe(metadata)
    expect(currentToolOutput(tool)).toBe("Running timeline tests...")
  })

  test("reads completed text without converting file content", () => {
    const tool = {
      type: "tool",
      id: "tool_completed",
      name: "read",
      state: {
        status: "completed",
        input: { path: "src/session.ts" },
        content: [
          { type: "text", text: "first" },
          { type: "file", mime: "text/plain", uri: "file:///src/session.ts", name: "session.ts" },
          { type: "text", text: "second" },
        ],
        metadata: { loaded: ["src/session.ts"] },
      },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolOutput(tool)).toBe("first\nsecond")
    expect(currentToolMetadata(tool)).toBe(tool.state.metadata)
  })

  test("keeps structured errors at the current boundary", () => {
    const tool = {
      type: "tool",
      id: "tool_error",
      name: "shell",
      state: {
        status: "error",
        input: { command: "bun test" },
        error: { type: "ToolExecutionError", message: "Command failed" },
      },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolError(tool)).toBe("Command failed")
    expect(currentToolOutput(tool)).toBeUndefined()
  })

  test("lists the images a script's result carries, leaving out its text and other files", () => {
    const screenshot = {
      type: "file",
      mime: "image/png",
      uri: `media:${"a".repeat(64)}`,
      name: "/tmp/shot.png",
    } as const

    const tool = {
      type: "tool",
      id: "tool_execute",
      name: "execute",
      state: {
        status: "completed",
        input: { code: "await tools.read({ path: '/tmp/shot.png' })" },
        content: [
          { type: "text", text: "done" },
          screenshot,
          { type: "file", mime: "application/pdf", uri: `media:${"b".repeat(64)}`, name: "/tmp/spec.pdf" },
        ],
      },
      time,
    } satisfies SessionMessageAssistantTool

    // The position counts the text, so the host finds the file in the call's content as the server has it.
    expect(currentToolImages(tool)).toEqual([{ ...screenshot, callID: "tool_execute", index: 1 }])
    expect(currentToolOutput(tool)).toBe("done")
  })

  test("keeps the images a failed script read before it threw", () => {
    const screenshot = { type: "file", mime: "image/jpeg", uri: "data:image/jpeg;base64,AA==" } as const

    const tool = {
      type: "tool",
      id: "tool_execute_failed",
      name: "execute",
      state: {
        status: "error",
        input: { code: "throw new Error('late')" },
        error: { type: "ToolExecutionError", message: "late" },
        content: [screenshot],
      },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolImages(tool)).toEqual([{ ...screenshot, callID: "tool_execute_failed", index: 0 }])
  })

  test("leaves an image read to the read row's own preview", () => {
    const tool = {
      type: "tool",
      id: "tool_read_image",
      name: "read",
      state: {
        status: "completed",
        input: { path: "/tmp/shot.png" },
        content: [{ type: "file", mime: "image/png", uri: `media:${"a".repeat(64)}`, name: "/tmp/shot.png" }],
      },
      time,
    } satisfies SessionMessageAssistantTool

    expect(currentToolImages(tool)).toEqual([])
  })
})
