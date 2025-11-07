import { describe, expect, test } from "bun:test"
import { MessageV2 } from "@/session/message-v2.ts"
import { Identifier } from "@/id/id.ts"

describe("MessageV2.toModelMessage", () => {
  describe("filters out messages with no convertible parts", () => {
    test("user message with only retry parts produces no message", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "user" as const,
            sessionID: "test-session",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "retry" as const,
              attempt: 1,
              error: {
                name: "APIError",
                data: {
                  message: "rate limit",
                  statusCode: 429,
                  isRetryable: true,
                },
              },
              time: { created: Date.now() },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Should not include messages with no convertible parts
      expect(result.length).toBe(0)
    })

    test("user message with text/plain file produces no message", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "user" as const,
            sessionID: "test-session",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "file" as const,
              mime: "text/plain", // Filtered out by toModelMessage
              filename: "test.txt",
              url: "data:text/plain;base64,dGVzdA==",
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Should not include text/plain files
      expect(result.length).toBe(0)
    })

    test("assistant message with only pending tool produces no message", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "assistant" as const,
            sessionID: "test-session",
            parentID: Identifier.ascending("message"),
            mode: "build",
            path: {
              cwd: "/test",
              root: "/test",
            },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test-model",
            providerID: "test",
            system: [],
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "tool" as const,
              callID: "call-123",
              tool: "test-tool",
              metadata: {},
              state: {
                status: "pending" as const, // Not handled in toModelMessage
                input: {},
                raw: "{}",
              },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Should not include assistant messages with only pending tools
      expect(result.length).toBe(0)
    })

    test("assistant message with only step-finish produces no message", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "assistant" as const,
            sessionID: "test-session",
            parentID: Identifier.ascending("message"),
            mode: "build",
            path: {
              cwd: "/test",
              root: "/test",
            },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test-model",
            providerID: "test",
            system: [],
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "step-finish" as const, // Not handled in toModelMessage
              reason: "max-steps",
              cost: 0,
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Should not include assistant messages with only step-finish
      expect(result.length).toBe(0)
    })
  })

  describe("includes messages with convertible parts", () => {
    test("user message with text part", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "user" as const,
            sessionID: "test-session",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "text" as const,
              text: "Hello world",
              time: { start: Date.now(), end: Date.now() },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      expect(result.length).toBe(1)
      expect(result[0].role).toBe("user")
      // Content is an array of parts for user messages
      expect(Array.isArray(result[0].content)).toBe(true)
      const content = result[0].content as any[]
      expect(content[0].text).toBe("Hello world")
    })

    test("assistant message with text and completed tool", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "assistant" as const,
            sessionID: "test-session",
            parentID: Identifier.ascending("message"),
            mode: "build",
            path: {
              cwd: "/test",
              root: "/test",
            },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test-model",
            providerID: "test",
            system: [],
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "text" as const,
              text: "Let me help with that",
              time: { start: Date.now(), end: Date.now() },
            },
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "tool" as const,
              callID: "call-123",
              tool: "test-tool",
              metadata: {},
              state: {
                status: "completed" as const,
                input: { arg: "value" },
                output: "result",
                title: "test-tool",
                metadata: {},
                time: { start: Date.now(), end: Date.now() },
              },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Assistant message is included
      expect(result.length).toBeGreaterThanOrEqual(1)
      const assistantMsg = result.find((m) => m.role === "assistant")
      expect(assistantMsg).toBeDefined()
      // Should have both text and tool parts in content
    })
  })

  describe("mixed scenarios", () => {
    test("message with some convertible and some non-convertible parts", () => {
      const input: { info: MessageV2.Info; parts: MessageV2.Part[] }[] = [
        {
          info: {
            id: Identifier.ascending("message"),
            role: "user" as const,
            sessionID: "test-session",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "text" as const,
              text: "Hello",
              time: { start: Date.now(), end: Date.now() },
            },
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "test-session",
              type: "retry" as const, // Not convertible
              attempt: 1,
              error: {
                name: "APIError",
                data: {
                  message: "error",
                  statusCode: 500,
                  isRetryable: true,
                },
              },
              time: { created: Date.now() },
            },
          ],
        },
      ]

      const result = MessageV2.toModelMessage(input)

      // Should include message because it has at least one convertible part
      expect(result.length).toBe(1)
      expect(Array.isArray(result[0].content)).toBe(true)
      const content = result[0].content as any[]
      expect(content[0].text).toBe("Hello")
    })
  })
})
