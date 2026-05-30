import { describe, expect, test } from "bun:test"
import { fromV1 } from "../../src/components/Share"

describe("Share.fromV1", () => {
  test("should convert assistant message with complete metadata", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
        assistant: {
          cost: 100,
          path: { cwd: "/home", root: "/home" },
          summary: "Test summary",
          tokens: {
            input: 10,
            output: 20,
            reasoning: 5,
            cache: { read: 100, write: 50 },
          },
          modelID: "claude-3-5-sonnet",
          providerID: "anthropic",
        },
      },
      parts: [{ type: "text" as const, text: "Hello world" }],
    }

    const result = fromV1(v1Message)

    expect(result.id).toBe("msg1")
    expect(result.sessionID).toBe("sess1")
    expect(result.role).toBe("assistant")
    expect(result.cost).toBe(100)
    expect(result.path).toEqual({ cwd: "/home", root: "/home" })
    expect(result.summary).toBe("Test summary")
    expect(result.tokens).toEqual({
      input: 10,
      output: 20,
      reasoning: 5,
      cache: { read: 100, write: 50 },
    })
    expect(result.modelID).toBe("claude-3-5-sonnet")
    expect(result.providerID).toBe("anthropic")
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].type).toBe("text")
  })

  test("should handle missing assistant metadata gracefully", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
      },
      parts: [],
    }

    expect(() => fromV1(v1Message)).not.toThrow()
    const result = fromV1(v1Message)
    expect(result.role).toBe("assistant")
    expect(result.cost).toBe(0)
    expect(result.path).toEqual({ cwd: "", root: "" })
    expect(result.tokens).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(result.modelID).toBe("")
    expect(result.providerID).toBe("")
  })

  test("should handle partial assistant metadata (missing tokens)", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
        assistant: {
          cost: 50,
        },
      },
      parts: [],
    }

    const result = fromV1(v1Message)
    expect(result.cost).toBe(50)
    expect(result.tokens).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
  })

  test("should handle user message with complete metadata", () => {
    const v1Message = {
      id: "msg1",
      role: "user" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000 },
      },
      parts: [{ type: "text" as const, text: "Hello" }],
    }

    const result = fromV1(v1Message)
    expect(result.id).toBe("msg1")
    expect(result.role).toBe("user")
    expect(result.parts).toHaveLength(1)
  })

  test("should handle user message with file part", () => {
    const v1Message = {
      id: "msg1",
      role: "user" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000 },
      },
      parts: [
        {
          type: "file" as const,
          mediaType: "image/png",
          filename: "screenshot.png",
          url: "https://example.com/screenshot.png",
        },
      ],
    }

    const result = fromV1(v1Message)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].type).toBe("file")
  })

  test("should handle tool invocation with missing tool metadata", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
        assistant: {
          cost: 10,
          modelID: "claude-3-5-sonnet",
          providerID: "anthropic",
        },
      },
      parts: [
        {
          type: "tool-invocation" as const,
          toolInvocation: {
            toolCallId: "call_123",
            toolName: "bash",
            state: "result" as const,
            args: { command: "ls" },
            result: "file1\nfile2",
          },
        },
      ],
    }

    expect(() => fromV1(v1Message)).not.toThrow()
    const result = fromV1(v1Message)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0].type).toBe("tool")
    expect(result.parts[0].state.status).toBe("completed")
  })

  test("should handle tool invocation with partial tool metadata", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
        assistant: {
          cost: 10,
          modelID: "claude-3-5-sonnet",
          providerID: "anthropic",
        },
        tool: {
          call_123: {
            title: "Bash command",
          },
          // Missing time for call_123
        },
      },
      parts: [
        {
          type: "tool-invocation" as const,
          toolInvocation: {
            toolCallId: "call_123",
            toolName: "bash",
            state: "result" as const,
            args: { command: "ls" },
            result: "file1\nfile2",
          },
        },
      ],
    }

    const result = fromV1(v1Message)
    expect(result.parts[0].state.status).toBe("completed")
    expect(result.parts[0].state.title).toBe("Bash command")
  })

  test("should skip unrecognized part types", () => {
    const v1Message = {
      id: "msg1",
      role: "assistant" as const,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000, completed: 2000 },
        assistant: {
          cost: 10,
        },
      },
      parts: [
        { type: "text" as const, text: "Hello" },
        { type: "unknown" as any, data: "test" },
        { type: "step-start" as const },
      ],
    }

    const result = fromV1(v1Message)
    expect(result.parts).toHaveLength(2)
  })

  test("should throw on unknown message role", () => {
    const v1Message = {
      id: "msg1",
      role: "system" as any,
      metadata: {
        sessionID: "sess1",
        time: { created: 1000 },
      },
      parts: [],
    }

    expect(() => fromV1(v1Message)).toThrow("unknown message type")
  })
})