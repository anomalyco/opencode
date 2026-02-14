import { convertToOpenAICompatibleChatMessages as convertToCopilotMessages } from "@/provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages"
import { describe, test, expect } from "bun:test"

describe("system messages", () => {
  test("should convert system message content to string", () => {
    const result = convertToCopilotMessages([
      {
        role: "system",
        content: "You are a helpful assistant with AGENTS.md instructions.",
      },
    ])

    expect(result).toEqual([
      {
        role: "system",
        content: "You are a helpful assistant with AGENTS.md instructions.",
      },
    ])
  })
})

describe("user messages", () => {
  test("should convert messages with only a text part to a string content", () => {
    const result = convertToCopilotMessages([
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ])

    expect(result).toEqual([{ role: "user", content: "Hello" }])
  })

  test("should convert messages with image parts", () => {
    const result = convertToCopilotMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          {
            type: "file",
            data: Buffer.from([0, 1, 2, 3]).toString("base64"),
            mediaType: "image/png",
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAECAw==" },
          },
        ],
      },
    ])
  })

  test("should convert messages with image parts from Uint8Array", () => {
    const result = convertToCopilotMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "Hi" },
          {
            type: "file",
            data: new Uint8Array([0, 1, 2, 3]),
            mediaType: "image/png",
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Hi" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAECAw==" },
          },
        ],
      },
    ])
  })

  test("should handle URL-based images", () => {
    const result = convertToCopilotMessages([
      {
        role: "user",
        content: [
          {
            type: "file",
            data: new URL("https://example.com/image.jpg"),
            mediaType: "image/*",
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "https://example.com/image.jpg" },
          },
        ],
      },
    ])
  })

  test("should handle multiple text parts without flattening", () => {
    const result = convertToCopilotMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    ])
  })
})

describe("assistant messages", () => {
  test("should convert assistant text messages", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello back!" }],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: "Hello back!",
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test("should handle assistant message with null content when only tool calls", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call1",
            toolName: "calculator",
            input: { a: 1, b: 2 },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call1",
            type: "function",
            function: {
              name: "calculator",
              arguments: JSON.stringify({ a: 1, b: 2 }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test("should concatenate multiple text parts", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          { type: "text", text: "First part. " },
          { type: "text", text: "Second part." },
        ],
      },
    ])

    expect(result[0].content).toBe("First part. Second part.")
  })
})

describe("tool calls", () => {
  test("should stringify arguments to tool calls", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            input: { foo: "bar123" },
            toolCallId: "quux",
            toolName: "thwomp",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "quux",
            toolName: "thwomp",
            output: { type: "json", value: { oof: "321rab" } },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "quux",
            type: "function",
            function: {
              name: "thwomp",
              arguments: JSON.stringify({ foo: "bar123" }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
      {
        role: "tool",
        tool_call_id: "quux",
        content: JSON.stringify({ oof: "321rab" }),
      },
    ])
  })

  test("should handle text output type in tool results", () => {
    const result = convertToCopilotMessages([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "getWeather",
            output: { type: "text", value: "It is sunny today" },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "It is sunny today",
      },
    ])
  })

  test("should handle multiple tool results as separate messages", () => {
    const result = convertToCopilotMessages([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call1",
            toolName: "api1",
            output: { type: "text", value: "Result 1" },
          },
          {
            type: "tool-result",
            toolCallId: "call2",
            toolName: "api2",
            output: { type: "text", value: "Result 2" },
          },
        ],
      },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      role: "tool",
      tool_call_id: "call1",
      content: "Result 1",
    })
    expect(result[1]).toEqual({
      role: "tool",
      tool_call_id: "call2",
      content: "Result 2",
    })
  })

  test("should handle text plus multiple tool calls", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking... " },
          {
            type: "tool-call",
            toolCallId: "call1",
            toolName: "searchTool",
            input: { query: "Weather" },
          },
          { type: "text", text: "Almost there..." },
          {
            type: "tool-call",
            toolCallId: "call2",
            toolName: "mapsTool",
            input: { location: "Paris" },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: "Checking... Almost there...",
        tool_calls: [
          {
            id: "call1",
            type: "function",
            function: {
              name: "searchTool",
              arguments: JSON.stringify({ query: "Weather" }),
            },
          },
          {
            id: "call2",
            type: "function",
            function: {
              name: "mapsTool",
              arguments: JSON.stringify({ location: "Paris" }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })
})

describe("reasoning (copilot-specific)", () => {
  test("should omit reasoning_text without reasoning_opaque", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          { type: "text", text: "The answer is 42." },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: "The answer is 42.",
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test("should include reasoning_opaque from providerOptions", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Thinking...",
            providerOptions: {
              copilot: { reasoningOpaque: "opaque-signature-123" },
            },
          },
          { type: "text", text: "Done!" },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: "Done!",
        tool_calls: undefined,
        reasoning_text: "Thinking...",
        reasoning_opaque: "opaque-signature-123",
      },
    ])
  })

  test("should include reasoning_opaque from text part providerOptions", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Done!",
            providerOptions: {
              copilot: { reasoningOpaque: "opaque-text-456" },
            },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: "Done!",
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: "opaque-text-456",
      },
    ])
  })

  test("should handle reasoning-only assistant message", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Just thinking, no response yet",
            providerOptions: {
              copilot: { reasoningOpaque: "sig-abc" },
            },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: undefined,
        reasoning_text: "Just thinking, no response yet",
        reasoning_opaque: "sig-abc",
      },
    ])
  })
})

describe("full conversation", () => {
  test("should convert a multi-turn conversation with reasoning", () => {
    const result = convertToCopilotMessages([
      {
        role: "system",
        content: "You are a helpful assistant.",
      },
      {
        role: "user",
        content: [{ type: "text", text: "What is 2+2?" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Let me calculate 2+2...",
            providerOptions: {
              copilot: { reasoningOpaque: "sig-abc" },
            },
          },
          { type: "text", text: "2+2 equals 4." },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "What about 3+3?" }],
      },
    ])

    expect(result).toHaveLength(4)

    const systemMsg = result[0]
    expect(systemMsg.role).toBe("system")

    // Assistant message should have reasoning fields
    const assistantMsg = result[2] as {
      reasoning_text?: string
      reasoning_opaque?: string
    }
    expect(assistantMsg.reasoning_text).toBe("Let me calculate 2+2...")
    expect(assistantMsg.reasoning_opaque).toBe("sig-abc")
  })
})
