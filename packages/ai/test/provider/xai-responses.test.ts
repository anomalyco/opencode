import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { XAIResponses } from "../../src/protocols/xai-responses.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = XAI.configure({ apiKey: "test", baseURL: "https://api.x.ai/v1" }).responses("grok-4.6")

describe("xAI Responses route", () => {
  it.effect("extends the Open Responses baseline directly", () =>
    Effect.gen(function* () {
      expect(XAIResponses.protocol.body).toBe(OpenResponses.protocol.body)
      expect(XAIResponses.protocol.body).not.toBe(OpenAIResponses.protocol.body)

      const prepared = yield* compileRequest(LLM.request({ model, prompt: "Hello" }))
      expect(prepared.protocol).toBe("xai-responses")
      expect(prepared.body.store).toBe(false)
      expect(prepared.body.include).toEqual(["reasoning.encrypted_content"])
    }),
  )

  it.effect("allows callers to opt out of encrypted reasoning", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(LLM.request({ model, prompt: "Hello", providerOptions: { include: [] } }))

      expect(prepared.body.store).toBe(false)
      expect(prepared.body.include).toBeUndefined()
    }),
  )

  it.effect("parses xAI reasoning summaries", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Think" })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "reasoning", id: "reasoning_1" },
              },
              // Grok streams reasoning with the standard summary event name.
              {
                type: "response.reasoning_summary_text.delta",
                item_id: "reasoning_1",
                summary_index: 0,
                delta: "Considering.",
              },
              {
                type: "response.output_item.done",
                item: { type: "reasoning", id: "reasoning_1", encrypted_content: "opaque" },
              },
              { type: "response.completed", response: { id: "response_1" } },
            ),
          ),
        ),
      )

      expect(response.message.content.find((part) => part.type === "reasoning")).toMatchObject({
        type: "reasoning",
        text: "Considering.",
        providerMetadata: { xai: { itemId: "reasoning_1", reasoningEncryptedContent: "opaque" } },
      })
    }),
  )

  it.effect("parses xAI hosted tool items", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Search X" })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.done",
                item: { type: "x_search_call", id: "x_search_1", status: "completed", action: { query: "news" } },
              },
              { type: "response.completed", response: { id: "response_1" } },
            ),
          ),
        ),
      )

      expect(response.events.find(LLMEvent.is.toolCall)).toMatchObject({
        id: "x_search_1",
        name: "x_search",
        input: { query: "news" },
        providerExecuted: true,
      })
    }),
  )
})
