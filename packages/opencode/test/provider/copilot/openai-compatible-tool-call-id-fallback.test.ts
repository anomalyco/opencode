import { OpenAICompatibleChatLanguageModel } from "@/provider/sdk/copilot/chat/openai-compatible-chat-language-model"
import { describe, test, expect, mock } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

async function convertReadableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

const FIXTURES = {
  // Provider omits 'id' (NVIDIA/Kimi K2.5 style). Arguments arrive in two chunks to
  // exercise the accumulation path — the first chunk has an empty arguments string so
  // isParsableJson doesn't prematurely finalise the call.
  toolCallMissingId: [
    `data: {"id":"chatcmpl-nvidia-1","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"function":{"name":"recall_memories","arguments":""}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-nvidia-1","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\""}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-nvidia-1","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"test\\"}"}}]},"finish_reason":"tool_calls"}]}`,
    `data: [DONE]`,
  ],
  // Provider includes 'id' — existing IDs must be preserved verbatim.
  toolCallWithId: [
    `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"id":"call_abc123","index":0,"function":{"name":"recall_memories","arguments":""}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_abc123","index":0,"function":{"arguments":"{\\"query\\":\\"test\\"}"}}]},"finish_reason":"tool_calls"}]}`,
    `data: [DONE]`,
  ],
  // Two parallel tool calls, both missing 'id'. Each must get a distinct fallback and
  // accumulate its own arguments correctly.
  multipleToolCallsMissingId: [
    `data: {"id":"chatcmpl-nvidia-2","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"function":{"name":"recall_memories","arguments":""}},{"index":1,"function":{"name":"add_memory","arguments":""}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-nvidia-2","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\""}},{"index":1,"function":{"arguments":"{\\"text\\""}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-nvidia-2","object":"chat.completion.chunk","created":1677652288,"model":"moonshotai/kimi-k2.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"test\\"}"}},{"index":1,"function":{"arguments":":\\"hello\\"}"}}]},"finish_reason":"tool_calls"}]}`,
    `data: [DONE]`,
  ],
}

function createMockFetch(chunks: string[]) {
  return mock(async () => {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk + "\n\n"))
        }
        controller.close()
      },
    })
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  })
}

function createModel(fetchFn: ReturnType<typeof mock>) {
  return new OpenAICompatibleChatLanguageModel("test-model", {
    provider: "copilot.chat",
    url: () => "https://api.test.com/chat/completions",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetchFn as any,
  })
}

describe("tool call ID fallback", () => {
  test("should generate fallback ID when streaming tool call is missing id field", async () => {
    const mockFetch = createMockFetch(FIXTURES.toolCallMissingId)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const toolInputStart = parts.find((p) => p.type === "tool-input-start")
    expect(toolInputStart).toBeDefined()
    expect((toolInputStart as { id: string }).id).toBeTruthy()

    const toolCall = parts.find((p) => p.type === "tool-call")
    expect(toolCall).toMatchObject({
      type: "tool-call",
      toolName: "recall_memories",
      input: '{"query":"test"}',
    })
    expect((toolCall as { toolCallId: string }).toolCallId).toBeTruthy()

    // fallback ID must be consistent across tool-input-start and tool-call
    expect((toolInputStart as { id: string }).id).toBe((toolCall as { toolCallId: string }).toolCallId)

    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: { unified: "tool-calls" },
    })
  })

  test("should preserve real id when provider includes it", async () => {
    const mockFetch = createMockFetch(FIXTURES.toolCallWithId)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const toolInputStart = parts.find((p) => p.type === "tool-input-start")
    expect(toolInputStart).toEqual({
      type: "tool-input-start",
      id: "call_abc123",
      toolName: "recall_memories",
    })

    const toolCall = parts.find((p) => p.type === "tool-call")
    expect(toolCall).toMatchObject({
      type: "tool-call",
      toolCallId: "call_abc123",
      toolName: "recall_memories",
      input: '{"query":"test"}',
    })
  })

  test("should generate unique fallback IDs for multiple tool calls missing id", async () => {
    const mockFetch = createMockFetch(FIXTURES.multipleToolCallsMissingId)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const toolInputStarts = parts.filter((p) => p.type === "tool-input-start")
    expect(toolInputStarts).toHaveLength(2)

    const ids = toolInputStarts.map((p) => (p as { id: string }).id)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])

    const toolCalls = parts.filter((p) => p.type === "tool-call")
    expect(toolCalls).toHaveLength(2)

    const recallCall = toolCalls.find((p) => (p as { toolName: string }).toolName === "recall_memories")
    expect(recallCall).toMatchObject({
      type: "tool-call",
      toolName: "recall_memories",
      input: '{"query":"test"}',
    })
    expect((recallCall as { toolCallId: string }).toolCallId).toBeTruthy()

    const addCall = toolCalls.find((p) => (p as { toolName: string }).toolName === "add_memory")
    expect(addCall).toMatchObject({
      type: "tool-call",
      toolName: "add_memory",
      input: '{"text":"hello"}',
    })
    expect((addCall as { toolCallId: string }).toolCallId).toBeTruthy()

    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: { unified: "tool-calls" },
    })
  })
})
