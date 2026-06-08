import { describe, expect, test } from "bun:test"
import { formatAssistantHeader, formatMessage, formatPart, formatTranscript, isPartVisible } from "../../src/util/transcript"
import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-20250514",
          url: "https://example.com/claude-sonnet-4-20250514",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 200_000,
          output: 8_192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

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

    test("uses model display name when available", () => {
      const result = formatAssistantHeader(baseMsg, true, providers)
      expect(result).toBe("## Assistant (Build · Claude Sonnet 4 · 5.4s)\n\n")
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
      expect(result).toContain("**Tool: bash**")
      expect(result).toContain("**Input:**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("formats tool output containing triple backticks without breaking markdown", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo '```hello```'" },
          output: "```hello```",
          title: "Echo backticks",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      // The tool header should not be inside a code block
      expect(result).toStartWith("**Tool: bash**\n")
      // Input and output should each be in their own code blocks
      expect(result).toContain("**Input:**\n```json")
      expect(result).toContain("**Output:**\n```\n```hello```\n```")
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
      expect(result).toContain("**Tool: bash**")
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

  describe("isPartVisible", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true, mode: "web" as const }

    test("hides web-mode running tool parts", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "ls" },
          time: { start: 1000 },
        },
      }
      expect(isPartVisible(part, "assistant", options, 0)).toBe(false)
    })

    test("hides web-mode empty text", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "text",
        text: "",
      }
      expect(isPartVisible(part, "assistant", options, 0)).toBe(false)
    })

    test("keeps first assistant step-start and hides later ones in web mode", () => {
      const part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "step-start",
      } as Part
      expect(isPartVisible(part, "assistant", options, 0)).toBe(true)
      expect(isPartVisible(part, "assistant", options, 1)).toBe(false)
    })

    test("hides snapshot-like internals in web mode", () => {
      const snapshot = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "snapshot",
      } as Part
      expect(isPartVisible(snapshot, "assistant", options, 0)).toBe(false)
    })
  })

  describe("formatMessage", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true, providers }

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
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 5.4s)")
      expect(result).toContain("Hi there")
    })

    test("returns empty output when no visible parts remain", () => {
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
      const parts: Part[] = [
        {
          id: "part_1",
          sessionID: "ses_123",
          messageID: "msg_123",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "running",
            input: { command: "ls" },
            time: { start: 1000 },
          },
        },
      ]
      const result = formatMessage(msg, parts, { ...options, mode: "web" })
      expect(result).toBe("")
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
      const options = {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
        providers,
      }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 0.5s)")
      expect(result).toContain("Hi!")
      expect(result).toContain("---")
    })

    test("falls back to raw model id when provider data is missing", () => {
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

      const result = formatTranscript(session, messages, {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
      })

      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 0.5s)")
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

    test("web mode omits separator for hidden-only messages", () => {
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
          parts: [
            {
              id: "part_1",
              sessionID: "ses_abc123",
              messageID: "msg_1",
              type: "tool" as const,
              callID: "call_1",
              tool: "bash",
              state: {
                status: "running" as const,
                input: { command: "ls" },
                time: { start: 1000 },
              },
            },
          ],
        },
      ]

      const result = formatTranscript(session, messages, {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
        mode: "web",
      })

      expect(result).not.toContain("## Assistant")
      expect(result).toBe(`# Test Session\n\n**Session ID:** ses_abc123\n**Created:** ${new Date(session.time.created).toLocaleString()}\n**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n---\n\n`)
    })
  })
})
