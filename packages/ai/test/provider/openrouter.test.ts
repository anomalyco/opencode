import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenRouter from "../../src/providers/openrouter"
import { it } from "../lib/effect"

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: { id: "openrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }).model("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )

  it.effect("preserves manually supplied reasoning details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "Think", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "ing", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 1 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "Thinking",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: null,
          reasoning: "Thinking",
          reasoning_details: details,
        },
      ])
    }),
  )

  it.effect("preserves opaque and duplicate continuation details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.future", format: "provider-v2", state: { opaque: true } },
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "Thinking",
              providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: null, reasoning: "Thinking", reasoning_details: details },
      ])
    }),
  )

  it.effect("does not merge distinct adjacent reasoning text blocks", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "first", index: 0, text: "A", opaque: "first" },
        { type: "reasoning.text", id: "second", index: 1, text: "B", opaque: "second" },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "AB",
              providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: null, reasoning: "AB", reasoning_details: details },
      ])
    }),
  )

  it.effect("omits scalar reasoning without continuation details", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [Message.assistant({ type: "reasoning", text: "Thinking" })],
        }),
      )

      expect(prepared.body.messages).toEqual([{ role: "assistant", content: null }])
    }),
  )
})
