import { describe, expect, test } from "bun:test"
import { ContextFilter } from "./context-filter"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"

describe("ContextFilter", () => {
  // Helper to create a mock message
  function createMessage(
    role: "user" | "assistant",
    parts: MessageV2.Part[],
  ): MessageV2.Info {
    return {
      id: Identifier.ascending("message"),
      sessionID: Identifier.ascending("session"),
      role,
      modelID: "test-model",
      providerID: "test-provider",
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      parts,
    } as MessageV2.Info
  }

  // Helper to create a text part
  function createTextPart(text: string): MessageV2.TextPart {
    return {
      id: Identifier.ascending("part"),
      sessionID: Identifier.ascending("session"),
      messageID: Identifier.ascending("message"),
      type: "text",
      text,
    }
  }

  // Helper to create a tool part
  function createToolPart(
    name: string,
    output: string,
    input: Record<string, any> = {},
  ): MessageV2.ToolPart {
    return {
      id: Identifier.ascending("part"),
      sessionID: Identifier.ascending("session"),
      messageID: Identifier.ascending("message"),
      type: "tool",
      name,
      state: {
        status: "completed",
        input,
        output,
        title: name,
        metadata: {},
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      },
    } as MessageV2.ToolPart
  }

  describe("mode: none", () => {
    test("returns empty array when mode is none", () => {
      const messages = [createMessage("user", [createTextPart("Hello")])]
      const result = ContextFilter.filter(messages, { mode: "none" })
      expect(result).toEqual([])
    })

    test("returns empty array when no config provided", () => {
      const messages = [createMessage("user", [createTextPart("Hello")])]
      const result = ContextFilter.filter(messages, undefined)
      expect(result).toEqual([])
    })
  })

  describe("mode: full", () => {
    test("returns all parts when mode is full", () => {
      const messages = [
        createMessage("user", [createTextPart("Message 1")]),
        createMessage("assistant", [createTextPart("Response 1")]),
      ]
      const result = ContextFilter.filter(messages, { mode: "full" })
      expect(result.length).toBe(2)
      expect((result[0] as MessageV2.TextPart).text).toBe("Message 1")
      expect((result[1] as MessageV2.TextPart).text).toBe("Response 1")
    })

    test("respects maxMessages limit", () => {
      const messages = [
        createMessage("user", [createTextPart("Message 1")]),
        createMessage("assistant", [createTextPart("Response 1")]),
        createMessage("user", [createTextPart("Message 2")]),
        createMessage("assistant", [createTextPart("Response 2")]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "full",
        maxMessages: 2,
      })
      expect(result.length).toBe(2)
      expect((result[0] as MessageV2.TextPart).text).toBe("Message 2")
      expect((result[1] as MessageV2.TextPart).text).toBe("Response 2")
    })

    test("respects maxTokens limit", () => {
      const longText = "x".repeat(1000)
      const messages = [
        createMessage("user", [createTextPart(longText)]),
        createMessage("assistant", [createTextPart("Short response")]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "full",
        maxTokens: 100, // ~400 chars
      })
      // Should include first message and maybe truncated second
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThanOrEqual(2)
    })
  })

  describe("mode: summary", () => {
    test("creates summary of session activity", () => {
      const messages = [
        createMessage("user", [createTextPart("User message 1")]),
        createMessage("assistant", [
          createTextPart("Assistant response"),
          createToolPart("read", "file content", { filePath: "test.ts" }),
        ]),
        createMessage("user", [createTextPart("User message 2")]),
        createMessage("assistant", [
          createToolPart("edit", "edited", { filePath: "test.ts" }),
          createToolPart("bash", "command output"),
        ]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "summary",
        includeFileChanges: true,
      })

      expect(result.length).toBe(1)
      expect(result[0].type).toBe("text")
      const summaryText = (result[0] as MessageV2.TextPart).text
      expect(summaryText).toContain("2 user messages")
      expect(summaryText).toContain("2 assistant responses")
      expect(summaryText).toContain("read: 1×")
      expect(summaryText).toContain("edit: 1×")
      expect(summaryText).toContain("bash: 1×")
      expect(summaryText).toContain("test.ts")
    })
  })

  describe("mode: filtered", () => {
    test("filters by message types", () => {
      const messages = [
        createMessage("user", [createTextPart("User message")]),
        createMessage("assistant", [createTextPart("Assistant message")]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "filtered",
        includeMessageTypes: ["user"],
      })

      expect(result.length).toBe(1)
      expect((result[0] as MessageV2.TextPart).text).toBe("User message")
    })

    test("filters by tool results", () => {
      const messages = [
        createMessage("assistant", [
          createToolPart("read", "file content"),
          createToolPart("bash", "command output"),
          createToolPart("edit", "edited content"),
        ]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "filtered",
        includeToolResults: ["read", "edit"],
      })

      expect(result.length).toBe(2)
      expect((result[0] as MessageV2.ToolPart).name).toBe("read")
      expect((result[1] as MessageV2.ToolPart).name).toBe("edit")
    })

    test("combines message type and tool filters", () => {
      const messages = [
        createMessage("user", [createTextPart("User message")]),
        createMessage("assistant", [
          createTextPart("Assistant text"),
          createToolPart("read", "file content"),
        ]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "filtered",
        includeMessageTypes: ["assistant"],
        includeToolResults: ["read"],
      })

      expect(result.length).toBe(2)
      expect(result[0].type).toBe("text")
      expect(result[1].type).toBe("tool")
    })

    test("respects maxMessages in filtered mode", () => {
      const messages = [
        createMessage("user", [createTextPart("Message 1")]),
        createMessage("user", [createTextPart("Message 2")]),
        createMessage("user", [createTextPart("Message 3")]),
      ]
      const result = ContextFilter.filter(messages, {
        mode: "filtered",
        maxMessages: 2,
      })

      expect(result.length).toBe(2)
      expect((result[0] as MessageV2.TextPart).text).toBe("Message 2")
      expect((result[1] as MessageV2.TextPart).text).toBe("Message 3")
    })
  })

  describe("token limit handling", () => {
    test("truncates content when exceeding token limit", () => {
      const longText = "x".repeat(2000)
      const messages = [createMessage("user", [createTextPart(longText)])]

      const result = ContextFilter.filter(messages, {
        mode: "full",
        maxTokens: 50, // ~200 chars
      })

      expect(result.length).toBe(1)
      const text = (result[0] as MessageV2.TextPart).text
      expect(text.length).toBeLessThan(longText.length)
      expect(text).toContain("(truncated)")
    })
  })
})
