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

  it.effect("merges streamed reasoning text fragments before replay", () =>
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
          reasoning_details: [
            {
              type: "reasoning.text",
              text: "Thinking",
              signature: "signed",
              format: "anthropic-claude-v1",
              index: 0,
            },
            { type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 1 },
          ],
        },
      ])
    }),
  )

  it.effect("keeps independently signed reasoning blocks separate", () =>
    Effect.gen(function* () {
      const details = [
        {
          type: "reasoning.text",
          text: "First",
          signature: "signed-0",
          format: "anthropic-claude-v1",
          index: 0,
        },
        {
          type: "reasoning.text",
          text: "Second",
          signature: "signed-1",
          format: "anthropic-claude-v1",
          index: 1,
        },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "FirstSecond",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({ reasoning_details: details })
    }),
  )

  it.effect("preserves unsigned and repeated reasoning details across history", () =>
    Effect.gen(function* () {
      const encrypted = { type: "reasoning.encrypted", id: "reasoning-1", data: "opaque", index: 0 }
      const unsigned = { type: "reasoning.text", text: "Unsigned", format: "anthropic-claude-v1", index: 0 }
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "Unsigned",
                providerMetadata: {
                  openai: {
                    reasoningField: "reasoning",
                    reasoningDetails: [unsigned],
                  },
                },
              },
            ]),
            Message.assistant([
              {
                type: "reasoning",
                text: "Encrypted",
                providerMetadata: { openai: { reasoningDetails: [encrypted] } },
              },
            ]),
            Message.assistant([
              {
                type: "reasoning",
                text: "Encrypted",
                providerMetadata: { openai: { reasoningDetails: [encrypted] } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { reasoning: "Unsigned", reasoning_details: [unsigned] },
        { reasoning_details: [encrypted] },
        { reasoning_details: [encrypted] },
      ])
    }),
  )

  it.effect("keeps identical independently signed blocks and detail types", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "same", signature: "signed-0", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "same", signature: "signed-1", format: "anthropic-claude-v1", index: 1 },
        { type: "reasoning.summary", summary: "same", format: "openai-responses-v1", index: 2 },
        { type: "reasoning.encrypted", data: "same", format: "openai-responses-v1", index: 3 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "samesame",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({ reasoning_details: details })
    }),
  )

  it.effect("does not merge adjacent text details without a shared identity", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "first", text: "A", format: "openai-responses-v1" },
        { type: "reasoning.text", text: "B", format: "openai-responses-v1" },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-5"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "AB",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({ reasoning_details: details })
    }),
  )

  it.effect("treats a signature as the boundary when block indices restart", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "A", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed-a", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "B", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed-b", format: "anthropic-claude-v1", index: 0 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "AB",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [
          { type: "reasoning.text", text: "A", signature: "signed-a", index: 0 },
          { type: "reasoning.text", text: "B", signature: "signed-b", index: 0 },
        ],
      })
    }),
  )

  it.effect("does not merge details across canonical reasoning parts", () =>
    Effect.gen(function* () {
      const first = [
        { type: "reasoning.text", text: "A", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed-a", format: "anthropic-claude-v1", index: 0 },
      ]
      const second = [
        { type: "reasoning.text", text: "B", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed-b", format: "anthropic-claude-v1", index: 0 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "A",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: first } },
              },
              {
                type: "reasoning",
                text: "B",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: second } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [
          { ...first[0], signature: "signed-a" },
          { ...second[0], signature: "signed-b" },
        ],
      })
    }),
  )

  it.effect("treats empty detail ids as absent during fragment merging", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "", text: "A", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", id: "block", signature: "signed", format: "anthropic-claude-v1", index: 0 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "A",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [{ type: "reasoning.text", id: "block", text: "A", signature: "signed", index: 0 }],
      })
    }),
  )

  it.effect("uses a matching non-empty id as authoritative fragment identity", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "block", text: "A", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", id: "block", text: "B", format: "anthropic-claude-v1", index: 1 },
        { type: "reasoning.text", id: "block", signature: "signed", format: "anthropic-claude-v1", index: 2 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "AB",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [{ type: "reasoning.text", id: "block", text: "AB", signature: "signed", index: 0 }],
      })
    }),
  )

  it.effect("does not erase opaque fragment fields with undefined values", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "A", format: "anthropic-claude-v1", index: 0, opaque: "keep" },
        {
          type: "reasoning.text",
          text: "B",
          signature: "signed",
          format: "anthropic-claude-v1",
          index: 0,
          opaque: undefined,
        },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "AB",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [{ type: "reasoning.text", text: "AB", signature: "signed", index: 0, opaque: "keep" }],
      })
    }),
  )

  it.effect("allows defined fragment fields to replace earlier undefined values", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "A", format: "anthropic-claude-v1", index: 0, opaque: undefined },
        {
          type: "reasoning.text",
          text: "B",
          signature: "signed",
          format: "anthropic-claude-v1",
          index: 0,
          opaque: "known",
        },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "AB",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [{ type: "reasoning.text", text: "AB", signature: "signed", index: 0, opaque: "known" }],
      })
    }),
  )

  it.effect("preserves an explicitly empty format from the first fragment", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "block", text: "A", format: "", index: 0 },
        { type: "reasoning.text", id: "block", signature: "signed", format: "later", index: 1 },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "A",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [
          { type: "reasoning.text", id: "block", text: "A", signature: "signed", format: "", index: 0 },
        ],
      })
    }),
  )

  it.effect("merges fragments with structurally equal opaque fields", () =>
    Effect.gen(function* () {
      const details = [
        {
          type: "reasoning.text",
          text: "A",
          format: "anthropic-claude-v1",
          index: 0,
          opaque: { version: 1 },
        },
        {
          type: "reasoning.text",
          signature: "signed",
          format: "anthropic-claude-v1",
          index: 0,
          opaque: { version: 1 },
        },
      ]
      const prepared = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "A",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages[0]).toMatchObject({
        reasoning_details: [
          {
            type: "reasoning.text",
            text: "A",
            signature: "signed",
            index: 0,
            opaque: { version: 1 },
          },
        ],
      })
    }),
  )
})
