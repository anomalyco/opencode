import { OpenAIResponsesLanguageModel } from "@/provider/sdk/copilot/responses/openai-responses-language-model"
import { describe, expect, mock, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

async function read<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader()
  const out: T[] = []
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return out
    out.push(chunk.value)
  }
}

function model(fetch: ReturnType<typeof mock>) {
  return new OpenAIResponsesLanguageModel("gpt-5", {
    provider: "copilot.responses",
    url: ({ path }) => `https://api.test.com${path}`,
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetch as any,
  })
}

describe("OpenAIResponsesLanguageModel", () => {
  test("accepts null phase in non-stream response", async () => {
    const fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            id: "resp_1",
            created_at: 1,
            error: null,
            model: "gpt-5",
            output: [
              {
                type: "message",
                role: "assistant",
                id: "msg_1",
                phase: null,
                content: [
                  {
                    type: "output_text",
                    text: "Hello",
                    logprobs: null,
                    annotations: [],
                  },
                ],
              },
            ],
            service_tier: null,
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: null },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: null },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    )

    const out = await model(fetch).doGenerate({
      prompt,
    })

    expect(out.content).toMatchObject([
      {
        type: "text",
        text: "Hello",
        providerMetadata: {
          openai: {
            itemId: "msg_1",
          },
        },
      },
    ])
  })

  test("keeps stable itemId on stream text-end when done id changes", async () => {
    const fetch = mock(async () => {
      const body = new ReadableStream({
        start(controller) {
          const lines = [
            {
              type: "response.created",
              sequence_number: 1,
              response: {
                id: "resp_1",
                created_at: 1,
                model: "gpt-5",
                service_tier: null,
              },
            },
            {
              type: "response.output_item.added",
              sequence_number: 2,
              output_index: 0,
              item: {
                type: "message",
                id: "msg_added",
                phase: "final_answer",
              },
            },
            {
              type: "response.output_text.delta",
              sequence_number: 3,
              item_id: "msg_delta",
              delta: "Hello",
              logprobs: null,
            },
            {
              type: "response.output_item.done",
              sequence_number: 4,
              output_index: 0,
              item: {
                type: "message",
                id: "msg_done",
                phase: "final_answer",
              },
            },
            {
              type: "response.completed",
              sequence_number: 5,
              response: {
                incomplete_details: null,
                service_tier: null,
                usage: {
                  input_tokens: 1,
                  input_tokens_details: { cached_tokens: null },
                  output_tokens: 1,
                  output_tokens_details: { reasoning_tokens: null },
                },
              },
            },
          ]

          for (const line of lines) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(line)}\n\n`))
          }
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
          controller.close()
        },
      })

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })

    const out = await model(fetch).doStream({
      prompt,
      includeRawChunks: false,
    })
    const parts = await read(out.stream)

    expect(parts.filter((part) => part.type === "text-start" || part.type === "text-end")).toMatchObject([
      {
        type: "text-start",
        id: "msg_added",
        providerMetadata: {
          openai: {
            itemId: "msg_added",
            phase: "final_answer",
          },
        },
      },
      {
        type: "text-end",
        id: "msg_added",
        providerMetadata: {
          openai: {
            itemId: "msg_added",
            phase: "final_answer",
          },
        },
      },
    ])
  })
})
