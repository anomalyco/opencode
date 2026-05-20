import { OpenAIResponsesLanguageModel } from "@opencode-ai/core/github-copilot/responses/openai-responses-language-model"
import { describe, expect, mock, test } from "bun:test"
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
  missingSummaryIndex: [
    [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp-1","created_at":1,"model":"gpt-5.4"}}',
    ].join("\n"),
    [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"canonical-reasoning-id","encrypted_content":"enc-start"}}',
    ].join("\n"),
    [
      "event: response.reasoning_summary_part.added",
      'data: {"type":"response.reasoning_summary_part.added","output_index":0,"item_id":"rotating-item-1"}',
    ].join("\n"),
    [
      "event: response.reasoning_summary_text.delta",
      'data: {"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"rotating-item-2","delta":"Thinking..."}',
    ].join("\n"),
    [
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"canonical-reasoning-id","encrypted_content":"enc-end"}}',
    ].join("\n"),
    [
      "event: response.completed",
      'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":1}},"service_tier":"default"}}',
    ].join("\n"),
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
  return new OpenAIResponsesLanguageModel("gpt-5.4", {
    provider: "copilot.responses",
    url: () => "https://api.test.com/responses",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetchFn as any,
  })
}

describe("OpenAIResponsesLanguageModel.doStream", () => {
  test("falls back to summary index 0 when Copilot omits summary_index", async () => {
    const mockFetch = createMockFetch(FIXTURES.missingSummaryIndex)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
      providerOptions: {
        copilot: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    })

    const parts = await convertReadableStreamToArray(stream)

    expect(parts.find((part) => part.type === "error")).toBeUndefined()

    const reasoningParts = parts.filter(
      (part) => part.type === "reasoning-start" || part.type === "reasoning-delta" || part.type === "reasoning-end",
    )

    expect(reasoningParts).toMatchObject([
      {
        type: "reasoning-start",
        id: "canonical-reasoning-id:0",
        providerMetadata: {
          openai: {
            itemId: "canonical-reasoning-id",
            reasoningEncryptedContent: "enc-start",
          },
        },
      },
      {
        type: "reasoning-delta",
        id: "canonical-reasoning-id:0",
        delta: "Thinking...",
        providerMetadata: {
          openai: {
            itemId: "canonical-reasoning-id",
          },
        },
      },
      {
        type: "reasoning-end",
        id: "canonical-reasoning-id:0",
        providerMetadata: {
          openai: {
            itemId: "canonical-reasoning-id",
            reasoningEncryptedContent: "enc-end",
          },
        },
      },
    ])
  })
})
