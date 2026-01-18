import { describe, expect, test } from "bun:test"
import { convertToKiroPayload } from "../../src/provider/sdk/kiro/src/converters"
import { normalizeModelName } from "../../src/provider/sdk/kiro/src/model-resolver"
import { parseAwsEventStream } from "../../src/provider/sdk/kiro/src/streaming"

describe("normalizeModelName", () => {
  test("converts claude-sonnet-4-5 to claude-sonnet-4.5", () => {
    expect(normalizeModelName("claude-sonnet-4-5")).toBe("claude-sonnet-4.5")
  })

  test("converts claude-haiku-4-5 to claude-haiku-4.5", () => {
    expect(normalizeModelName("claude-haiku-4-5")).toBe("claude-haiku-4.5")
  })

  test("converts claude-opus-4-5 to claude-opus-4.5", () => {
    expect(normalizeModelName("claude-opus-4-5")).toBe("claude-opus-4.5")
  })

  test("converts claude-sonnet-4 to claude-sonnet-4", () => {
    expect(normalizeModelName("claude-sonnet-4")).toBe("claude-sonnet-4")
  })

  test("handles model with date suffix", () => {
    expect(normalizeModelName("claude-sonnet-4-5-20251001")).toBe("claude-sonnet-4.5")
  })

  test("maps claude-3-7-sonnet to hidden model ID", () => {
    expect(normalizeModelName("claude-3-7-sonnet")).toBe("CLAUDE_3_7_SONNET_20250219_V1_0")
  })

  test("maps claude-3.7-sonnet to hidden model ID", () => {
    expect(normalizeModelName("claude-3.7-sonnet")).toBe("CLAUDE_3_7_SONNET_20250219_V1_0")
  })

  test("preserves unknown model names", () => {
    expect(normalizeModelName("unknown-model")).toBe("unknown-model")
  })

  test("handles uppercase input", () => {
    expect(normalizeModelName("CLAUDE-SONNET-4-5")).toBe("claude-sonnet-4.5")
  })
})

describe("convertToKiroPayload", () => {
  const modelId = "claude-sonnet-4.5"

  test("converts simple user message", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] }]

    const result = convertToKiroPayload(prompt, modelId)

    expect(result.conversationState.chatTriggerType).toBe("MANUAL")
    expect(result.conversationState.conversationId).toBeDefined()
    expect(result.conversationState.currentMessage.userInputMessage.content).toBe("Hello")
    expect(result.conversationState.currentMessage.userInputMessage.modelId).toBe(modelId)
    expect(result.conversationState.currentMessage.userInputMessage.origin).toBe("AI_EDITOR")
    expect(result.conversationState.history).toHaveLength(0)
  })

  test("extracts system prompt", () => {
    const prompt = [
      { role: "system" as const, content: "You are a helpful assistant" },
      { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
    ]

    const result = convertToKiroPayload(prompt, modelId)

    expect(result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.systemPrompt).toBe(
      "You are a helpful assistant",
    )
  })

  test("converts tools to Kiro format", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Run a command" }] }]
    const tools = [
      {
        type: "function" as const,
        name: "bash",
        description: "Execute a bash command",
        inputSchema: {
          type: "object" as const,
          properties: {
            command: { type: "string" as const, description: "The command to run" },
          },
          required: ["command"],
        },
      },
    ]

    const result = convertToKiroPayload(prompt, modelId, tools as any)

    const kiroTools = result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools
    expect(kiroTools).toBeDefined()
    expect(kiroTools).toHaveLength(1)
    expect(kiroTools![0].toolSpecification.name).toBe("bash")
    expect(kiroTools![0].toolSpecification.description).toBe("Execute a bash command")
  })

  test("sanitizes JSON schema - removes empty required array", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Test" }] }]
    const tools = [
      {
        type: "function" as const,
        name: "test",
        description: "Test tool",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [], // Empty array should be removed
        },
      },
    ]

    const result = convertToKiroPayload(prompt, modelId, tools as any)

    const schema = result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools![0]
      .toolSpecification.inputSchema.json as Record<string, unknown>
    expect(schema.required).toBeUndefined()
  })

  test("sanitizes JSON schema - removes additionalProperties", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Test" }] }]
    const tools = [
      {
        type: "function" as const,
        name: "test",
        description: "Test tool",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
          },
          additionalProperties: false, // Should be removed
        },
      },
    ]

    const result = convertToKiroPayload(prompt, modelId, tools)

    const schema = result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools![0]
      .toolSpecification.inputSchema.json as Record<string, unknown>
    expect(schema.additionalProperties).toBeUndefined()
  })

  test("builds history from multi-turn conversation", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi there!" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "How are you?" }] },
    ]

    const result = convertToKiroPayload(prompt, modelId)

    expect(result.conversationState.history).toHaveLength(2)
    expect(result.conversationState.history[0].userInputMessage?.content).toBe("Hello")
    expect(result.conversationState.history[1].assistantResponseMessage?.content).toBe("Hi there!")
    expect(result.conversationState.currentMessage.userInputMessage.content).toBe("How are you?")
  })

  test("handles tool calls in assistant messages", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_123",
            toolName: "bash",
            input: { command: "ls" },
          },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_123",
            toolName: "bash",
            output: { type: "text" as const, value: "file1.txt\nfile2.txt" },
          },
        ],
      },
      { role: "user" as const, content: [{ type: "text" as const, text: "Thanks" }] },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)

    // Check that tool calls are in history
    const assistantMsg = result.conversationState.history.find((h) => h.assistantResponseMessage?.toolUses)
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.assistantResponseMessage?.toolUses).toHaveLength(1)
    expect(assistantMsg?.assistantResponseMessage?.toolUses![0].name).toBe("bash")
  })

  test("handles tool results in current message", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Run ls" }] },
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_123",
            toolName: "bash",
            input: { command: "ls" },
          },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_123",
            toolName: "bash",
            output: { type: "text" as const, value: "file1.txt" },
          },
        ],
      },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)

    const toolResults = result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults
    expect(toolResults).toBeDefined()
    expect(toolResults).toHaveLength(1)
    expect(toolResults![0].toolUseId).toBe("call_123")
    expect(toolResults![0].content[0].text).toBe("file1.txt")
    expect(toolResults![0].status).toBe("success")
  })

  test("handles error tool results", () => {
    const prompt = [
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_123",
            toolName: "bash",
            output: { type: "error-text" as const, value: "Command failed" },
          },
        ],
      },
    ]

    const result = convertToKiroPayload(prompt as any, modelId)

    const toolResults = result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults
    expect(toolResults![0].status).toBe("error")
  })

  describe("thinking mode (Fake Reasoning)", () => {
    test("injects thinking tags when enabled", () => {
      const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Solve this problem" }] }]
      const providerOptions = {
        thinking: {
          type: "enabled" as const,
          budgetTokens: 16000,
        },
      }

      const result = convertToKiroPayload(prompt, modelId, undefined, providerOptions)

      const content = result.conversationState.currentMessage.userInputMessage.content
      expect(content).toContain("<thinking_mode>enabled</thinking_mode>")
      expect(content).toContain("<max_thinking_length>16000</max_thinking_length>")
      expect(content).toContain("<thinking_instruction>")
      expect(content).toContain("Solve this problem")
    })

    test("adds thinking system prompt addition when enabled", () => {
      const prompt = [
        { role: "system" as const, content: "You are helpful" },
        { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
      ]
      const providerOptions = {
        thinking: {
          type: "enabled" as const,
          budgetTokens: 16000,
        },
      }

      const result = convertToKiroPayload(prompt, modelId, undefined, providerOptions)

      const systemPrompt =
        result.conversationState.currentMessage.userInputMessage.userInputMessageContext?.systemPrompt
      expect(systemPrompt).toContain("You are helpful")
      expect(systemPrompt).toContain("Extended Thinking Mode")
      expect(systemPrompt).toContain("<thinking>...</thinking>")
    })

    test("does not inject thinking tags when disabled", () => {
      const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] }]
      const providerOptions = {
        thinking: {
          type: "disabled" as const,
        },
      }

      const result = convertToKiroPayload(prompt, modelId, undefined, providerOptions)

      const content = result.conversationState.currentMessage.userInputMessage.content
      expect(content).not.toContain("<thinking_mode>")
      expect(content).toBe("Hello")
    })

    test("uses default budget tokens when not specified", () => {
      const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Test" }] }]
      const providerOptions = {
        thinking: {
          type: "enabled" as const,
        },
      }

      const result = convertToKiroPayload(prompt, modelId, undefined, providerOptions)

      const content = result.conversationState.currentMessage.userInputMessage.content
      expect(content).toContain("<max_thinking_length>16000</max_thinking_length>")
    })
  })

  test("handles empty user content with minimal placeholder", () => {
    const prompt = [{ role: "user" as const, content: [] }]

    const result = convertToKiroPayload(prompt, modelId)

    expect(result.conversationState.currentMessage.userInputMessage.content).toBe(".")
  })

  test("merges consecutive assistant messages", () => {
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Part 1" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Part 2" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Continue" }] },
    ]

    const result = convertToKiroPayload(prompt, modelId)

    // Should merge consecutive assistant messages
    const assistantMsgs = result.conversationState.history.filter((h) => h.assistantResponseMessage)
    expect(assistantMsgs).toHaveLength(1)
    expect(assistantMsgs[0].assistantResponseMessage?.content).toContain("Part 1")
    expect(assistantMsgs[0].assistantResponseMessage?.content).toContain("Part 2")
  })
})

// Note: parseAwsEventStream tests are skipped because they require
// proper AWS Event Stream binary format which is complex to construct in tests.
// The streaming functionality is tested through integration tests.
// The converter and model-resolver tests above provide good coverage of the core logic.
