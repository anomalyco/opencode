import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"

describe("structured-output.OutputFormat", () => {
  test("parses text format", () => {
    const result = MessageV2.Format.safeParse({ type: "text" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("text")
    }
  })

  test("parses json_schema format with defaults", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object", properties: { name: { type: "string" } } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("json_schema")
      if (result.data.type === "json_schema") {
        expect(result.data.retryCount).toBe(2) // default value
      }
    }
  })

  test("parses json_schema format with custom retryCount", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: 5,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "json_schema") {
      expect(result.data.retryCount).toBe(5)
    }
  })

  test("rejects invalid type", () => {
    const result = MessageV2.Format.safeParse({ type: "invalid" })
    expect(result.success).toBe(false)
  })

  test("rejects json_schema without schema", () => {
    const result = MessageV2.Format.safeParse({ type: "json_schema" })
    expect(result.success).toBe(false)
  })

  test("rejects negative retryCount", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe("structured-output.StructuredOutputError", () => {
  test("creates error with message and retries", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Failed to validate",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toBe("Failed to validate")
    expect(error.data.retries).toBe(3)
  })

  test("converts to object correctly", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test error",
      retries: 2,
    })

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.message).toBe("Test error")
    expect(obj.data.retries).toBe(2)
  })

  test("isInstance correctly identifies error", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test",
      retries: 1,
    })

    expect(MessageV2.StructuredOutputError.isInstance(error)).toBe(true)
    expect(MessageV2.StructuredOutputError.isInstance({ name: "other" })).toBe(false)
  })
})

describe("structured-output.UserMessage", () => {
  test("user message accepts outputFormat", () => {
    const result = MessageV2.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      outputFormat: {
        type: "json_schema",
        schema: { type: "object" },
      },
    })
    expect(result.success).toBe(true)
  })

  test("user message works without outputFormat (optional)", () => {
    const result = MessageV2.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
    })
    expect(result.success).toBe(true)
  })
})

describe("structured-output.AssistantMessage", () => {
  const baseAssistantMessage = {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "assistant" as const,
    parentID: MessageID.ascending(),
    modelID: "claude-3",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/test", root: "/test" },
    cost: 0.001,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }

  test("assistant message accepts structured", () => {
    const result = MessageV2.Assistant.safeParse({
      ...baseAssistantMessage,
      structured: { company: "Anthropic", founded: 2021 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.structured).toEqual({ company: "Anthropic", founded: 2021 })
    }
  })

  test("assistant message works without structured_output (optional)", () => {
    const result = MessageV2.Assistant.safeParse(baseAssistantMessage)
    expect(result.success).toBe(true)
  })
})
