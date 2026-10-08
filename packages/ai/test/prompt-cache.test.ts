import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, ToolDefinition } from "../src/index.js"
import { PromptCache } from "../src/prompt-cache.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../src/protocols.js"
import { compileRequest, LLMClient } from "../src/route/client.js"
import { OpenAI } from "../src/providers/index.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

describe("native prompt cache options", () => {
  it.effect("places 1h Anthropic markers on tools, system, and messages with TTL-only configuration", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({
          model: AnthropicMessages.route.model({ id: "claude-sonnet-4-5" }),
          system: "Stable instructions",
          prompt: "Question",
          tools: [
            ToolDefinition.make({ name: "read", description: "Read", inputSchema: { type: "object", properties: {} } }),
          ],
        }),
        { cache_control: { type: "ephemeral", ttl: "1h" } },
      )
      const compiled = yield* compileRequest(request)
      expect(compiled.body).toMatchObject({
        tools: [{ cache_control: { type: "ephemeral", ttl: "1h" } }],
        system: [{ cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ content: [{ cache_control: { type: "ephemeral", ttl: "1h" } }] }],
      })
    }),
  )

  it.effect("empty options preserve the request and 5m does not become 1h", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: AnthropicMessages.route.model({ id: "claude-sonnet-4-5" }),
        prompt: "Question",
      })
      expect(yield* PromptCache.apply(request, {})).toBe(request)
      const configured = yield* PromptCache.apply(request, { cache_control: { type: "ephemeral", ttl: "5m" } })
      const compiled = yield* compileRequest(configured)
      expect(compiled.body).toMatchObject({ messages: [{ content: [{ cache_control: { type: "ephemeral" } }] }] })
      expect(JSON.stringify(compiled.body)).not.toContain('"1h"')
    }),
  )

  for (const route of [OpenAIChat.route, OpenAIResponses.route]) {
    it.effect(`sends GPT-5.6+ cache options unchanged on ${route.id}`, () =>
      Effect.gen(function* () {
        for (const id of [
          "gpt-5.6",
          "gpt-5.6-2026-08-01",
          "gpt-5.10",
          "gpt-6-astra",
          "gpt-6.1-sol",
          "deployment-alias",
        ]) {
          const request = LLM.request({ model: route.model({ id }), prompt: "Question" })
          for (const options of [{}, { ttl: "30m" }, { mode: "implicit", ttl: "30m" }, { mode: "explicit" }] as const) {
            const configured = yield* PromptCache.apply(request, { prompt_cache_options: options })
            const compiled = yield* compileRequest(configured)
            expect(compiled.body).toMatchObject({ prompt_cache_options: options })
            expect(compiled.body).not.toHaveProperty("prompt_cache_retention")
          }
          expect((yield* compileRequest(request)).body).not.toHaveProperty("prompt_cache_options")
          const combined = yield* PromptCache.apply(request, {
            prompt_cache_retention: "24h",
            prompt_cache_options: { ttl: "30m" },
          })
          expect((yield* compileRequest(combined)).body).toMatchObject({
            prompt_cache_retention: "24h",
            prompt_cache_options: { ttl: "30m" },
          })
        }
      }),
    )
    it.effect(`sends OpenAI retention on ${route.id}`, () =>
      Effect.gen(function* () {
        const request = LLM.request({ model: route.model({ id: "gpt-5.4" }), prompt: "Question" })
        const configured = yield* PromptCache.apply(request, { prompt_cache_retention: "24h" })
        const compiled = yield* compileRequest(configured)
        expect(compiled.body).toMatchObject({ prompt_cache_retention: "24h" })
        expect((yield* compileRequest(request)).body).not.toHaveProperty("prompt_cache_retention")
        // The low-level provider API remains forward compatible; config rules validate their own allowed values.
        const future = LLM.request({
          model: route.model({ id: "gpt-5.4" }),
          prompt: "Question",
          providerOptions: { promptCacheRetention: "future-retention" },
        })
        expect((yield* compileRequest(future)).body).toMatchObject({ prompt_cache_retention: "future-retention" })
      }),
    )
  }

  it.effect("rejects route mismatches, combined options, and incompatible model settings", () =>
    Effect.gen(function* () {
      const anthropic = LLM.request({ model: AnthropicMessages.route.model({ id: "claude-sonnet-4-5" }) })
      const openai = LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-5.4" }) })
      const failures = [
        PromptCache.apply(anthropic, { prompt_cache_retention: "24h" }),
        PromptCache.apply(openai, { cache_control: { type: "ephemeral" } }),
        PromptCache.apply(anthropic, { cache_control: { type: "ephemeral" }, prompt_cache_retention: "24h" }),
        PromptCache.apply(anthropic, { prompt_cache_options: { ttl: "30m" } }),
        PromptCache.apply(anthropic, { cache_control: { type: "ephemeral" }, prompt_cache_options: {} }),
        ...["gpt-4.1", "gpt-5", "gpt-5.5"].map((id) =>
          PromptCache.apply(LLM.request({ model: OpenAIResponses.route.model({ id }) }), {
            prompt_cache_options: { ttl: "30m" },
          }),
        ),
        PromptCache.apply(LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-5.5" }) }), {
          prompt_cache_retention: "in_memory",
        }),
        PromptCache.apply(LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-6.1-sol" }) }), {
          prompt_cache_retention: "in_memory",
        }),
      ]
      for (const failure of failures) {
        const result = yield* Effect.flip(failure)
        expect(result.reason._tag).toBe("InvalidRequest")
      }
    }),
  )
})

for (const scenario of [
  { model: "gpt-5.4", options: { prompt_cache_retention: "24h" } },
  { model: "gpt-5.6", options: { prompt_cache_options: { ttl: "30m" } } },
  { model: "gpt-6.1-sol", options: { prompt_cache_options: { mode: "explicit", ttl: "30m" } } },
  {
    model: "gpt-5.6",
    options: { prompt_cache_retention: "24h", prompt_cache_options: { mode: "implicit", ttl: "30m" } },
  },
] as const) {
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toBe("/v1/responses/compact")
        expect(JSON.parse(text)).toMatchObject(scenario.options)
        return respond(
          JSON.stringify({
            object: "response.compaction",
            output: [{ type: "compaction", id: "cmp_cache", encrypted_content: "opaque" }],
          }),
        )
      }),
    ),
  ).effect(`preserves cache options on native compaction: ${scenario.model} ${JSON.stringify(scenario.options)}`, () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses(scenario.model), prompt: "Question" }),
        scenario.options,
      )
      yield* LLMClient.compact(request)
    }),
  )
}
