import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { currentToolError, currentToolInput, currentToolMetadata, currentToolOutput } from "./current-tool-state"

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
})
