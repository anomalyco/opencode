import { OpenAIResponsesLanguageModel } from "@opencode-ai/core/github-copilot/responses/openai-responses-language-model"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { describe, expect, mock, test } from "bun:test"

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

function createMockFetch(response: unknown): FetchFunction {
  return Object.assign(
    mock(async () => {
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }),
    { preconnect: () => {} },
  )
}

function createModel(fetch: FetchFunction) {
  return new OpenAIResponsesLanguageModel("gpt-5.5", {
    provider: "test.responses",
    url: () => "https://api.test.com/responses",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch,
  })
}

describe("OpenAIResponsesLanguageModel.doGenerate", () => {
  test("accepts output_text without annotations", async () => {
    const model = createModel(
      createMockFetch({
        id: "resp_1",
        created_at: 1710000000,
        model: "gpt-5.5",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_1",
            content: [
              {
                type: "output_text",
                text: "Hello",
                logprobs: null,
              },
            ],
          },
        ],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    )

    const result = await model.doGenerate({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    expect(result.content).toMatchObject([
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
})
