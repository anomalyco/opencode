import { describe, expect, test } from "bun:test"
import {
  formatAssistantHeader,
  formatMessage,
  formatPart,
  formatTranscript,
} from "../../../src/cli/cmd/tui/util/transcript"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"

describe("transcript", () => {
  describe("formatAssistantHeader", () => {
    const baseMsg: AssistantMessage = {
      id: "msg_123",
      sessionID: "ses_123",
      role: "assistant",
      agent: "build",
      modelID: "claude-sonnet-4-20250514",
      providerID: "anthropic",
      mode: "",
      parentID: "msg_parent",
      path: { cwd: "/test", root: "/test" },
      cost: 0.001,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000000, completed: 1005400 },
    }

    test("includes metadata when enabled", () => {
      const result = formatAssistantHeader(baseMsg, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514 · 5.4s)\n\n")
    })

    test("excludes metadata when disabled", () => {
      const result = formatAssistantHeader(baseMsg, false)
      expect(result).toBe("## Assistant\n\n")
    })

    test("handles missing completed time", () => {
      const msg = { ...baseMsg, time: { created: 1000000 } }
      const result = formatAssistantHeader(msg as AssistantMessage, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514)\n\n")
    })

    test("titlecases agent name", () => {
      const msg = { ...baseMsg, agent: "plan" }
      const result = formatAssistantHeader(msg, true)
      expect(result).toContain("Plan")
    })
  })

  describe("formatPart", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true }

    test("formats text part", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "text",
        text: "Hello world",
      }
      const result = formatPart(part, options)
      expect(result).toBe("Hello world\n\n")
    })

    test("skips synthetic text parts", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "text",
        text: "Synthetic content",
        synthetic: true,
      }
      const result = formatPart(part, options)
      expect(result).toBe("")
    })

    test("formats reasoning when thinking enabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, options)
      expect(result).toBe("_Thinking:_\n\nLet me think...\n\n")
    })

    test("skips reasoning when thinking disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, { ...options, thinking: false })
      expect(result).toBe("")
    })

    test("formats tool part with details", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt\nfile2.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("Tool: bash")
      expect(result).toContain("**Input:**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("formats tool part without details when disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, { ...options, toolDetails: false })
      expect(result).toContain("Tool: bash")
      expect(result).not.toContain("**Input:**")
      expect(result).not.toContain("**Output:**")
    })

    test("formats tool error", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "invalid" },
          error: "Command failed",
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("**Error:**")
      expect(result).toContain("Command failed")
    })
  })

  describe("formatMessage", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true }

    test("formats user message", () => {
      const msg: UserMessage = {
        id: "msg_123",
        sessionID: "ses_123",
        role: "user",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        time: { created: 1000000 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123", messageID: "msg_123", type: "text", text: "Hello" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
    })

    test("formats assistant message with metadata", () => {
      const msg: AssistantMessage = {
        id: "msg_123",
        sessionID: "ses_123",
        role: "assistant",
        agent: "build",
        modelID: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        mode: "",
        parentID: "msg_parent",
        path: { cwd: "/test", root: "/test" },
        cost: 0.001,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1000000, completed: 1005400 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123", messageID: "msg_123", type: "text", text: "Hi there" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 5.4s)")
      expect(result).toContain("Hi there")
    })
  })

  describe("formatTranscript", () => {
    test("formats complete transcript", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123",
            role: "user" as const,
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
            time: { created: 1000000000000 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123", messageID: "msg_1", type: "text" as const, text: "Hello" }],
        },
        {
          info: {
            id: "msg_2",
            sessionID: "ses_abc123",
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_1",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p2", sessionID: "ses_abc123", messageID: "msg_2", type: "text" as const, text: "Hi!" }],
        },
      ]
      const options = { thinking: false, toolDetails: false, assistantMetadata: true }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 0.5s)")
      expect(result).toContain("Hi!")
      expect(result).toContain("---")
    })

    test("formats transcript without assistant metadata", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123",
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123", messageID: "msg_1", type: "text" as const, text: "Response" }],
        },
      ]
      const options = { thinking: false, toolDetails: false, assistantMetadata: false }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("## Assistant\n\n")
      expect(result).not.toContain("Build")
      expect(result).not.toContain("claude-sonnet-4-20250514")
    })
  })
})
