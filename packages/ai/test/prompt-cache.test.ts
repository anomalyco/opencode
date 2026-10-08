import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, ToolDefinition } from "../src/index.js"
import { PromptCache } from "../src/prompt-cache.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../src/protocols.js"
import { compileRequest, LLMClient } from "../src/route/client.js"
import { AmazonBedrock, AnthropicCompatible, OpenAI, OpenRouter } from "../src/providers/index.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

const bedrock = AmazonBedrock.configure({
  credentials: { region: "us-east-1", accessKeyId: "fixture", secretAccessKey: "fixture" },
})

describe("native prompt cache options", () => {
  it.effect("places Anthropic TTL markers on tools, system, and the conversation tail", () =>
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
      expect((yield* compileRequest(request)).body).toMatchObject({
        tools: [{ cache_control: { type: "ephemeral", ttl: "1h" } }],
        system: [{ cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ content: [{ cache_control: { type: "ephemeral", ttl: "1h" } }] }],
      })
    }),
  )

  it.effect("empty options preserve the request", () =>
    Effect.gen(function* () {
      const request = LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-5.6" }), prompt: "Question" })
      expect(yield* PromptCache.apply(request, {})).toBe(request)
      expect((yield* compileRequest(request)).body).not.toHaveProperty("prompt_cache_options")
    }),
  )

  it.effect("sends legacy retention through Chat Completions", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({ model: OpenAIChat.route.model({ id: "gpt-5.4" }), prompt: "Question" }),
        {
          prompt_cache_retention: "24h",
        },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({ prompt_cache_retention: "24h" })
    }),
  )

  it.effect("sends both independent OpenAI fields without converting their lifetimes", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-5.6" }), prompt: "Question" }),
        {
          prompt_cache_options: { mode: "implicit", ttl: "30m" },
          prompt_cache_retention: "24h",
        },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
        prompt_cache_retention: "24h",
      })
    }),
  )

  it.effect("leaves model-specific validation to OpenAI rather than guessing from its ID", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({ model: OpenAIResponses.route.model({ id: "gpt-5.5" }), prompt: "Question" }),
        {
          prompt_cache_options: { mode: "explicit" },
          prompt_cache_retention: "in_memory",
        },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({
        prompt_cache_options: { mode: "explicit" },
        prompt_cache_retention: "in_memory",
      })
    }),
  )

  it.effect("preserves future low-level provider option values and deployment aliases", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: OpenAIResponses.route.model({ id: "deployment-alias" }),
        prompt: "Question",
        providerOptions: {
          promptCacheRetention: "future-retention",
          promptCacheOptions: { mode: "future-mode", ttl: "future-ttl" },
        },
      })
      expect((yield* compileRequest(request)).body).toMatchObject({
        prompt_cache_retention: "future-retention",
        prompt_cache_options: { mode: "future-mode", ttl: "future-ttl" },
      })
    }),
  )

  it.effect("uses cache markers on Anthropic-compatible endpoints", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({
          model: AnthropicCompatible.configure({ baseURL: "https://example.test/v1", apiKey: "test" }).model("claude"),
          prompt: "Question",
        }),
        { cache_control: { type: "ephemeral", ttl: "1h" } },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({
        messages: [{ content: [{ cache_control: { type: "ephemeral", ttl: "1h" } }] }],
      })
    }),
  )

  it.effect("uses cache markers for Anthropic through OpenRouter", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test" }).model("anthropic/claude-sonnet-4.5"),
          prompt: "Question",
        }),
        { cache_control: { type: "ephemeral", ttl: "1h" } },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({
        messages: [{ content: [{ cache_control: { type: "ephemeral", ttl: "1h" } }] }],
      })
    }),
  )

  it.effect("retains the existing Qwen placement policy on gateways", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test" }).model("qwen/qwen3-coder"),
          prompt: "Question",
        }),
        { cache_control: { type: "ephemeral", ttl: "5m" } },
      )
      expect(request.cache).toEqual({ system: true, messages: { tail: 1 }, ttlSeconds: 300 })
    }),
  )

  it.effect("sends one-hour TTLs through supported Bedrock Converse models", () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({
          model: bedrock.model("anthropic.claude-sonnet-4-5-20250929-v1:0"),
          prompt: "Question",
        }),
        { cache_control: { type: "ephemeral", ttl: "1h" } },
      )
      expect((yield* compileRequest(request)).body).toMatchObject({
        messages: [{ content: [{ text: "Question" }, { cachePoint: { type: "default", ttl: "1h" } }] }],
      })
    }),
  )

  it.effect("rejects a Bedrock TTL that existing lowering would shorten", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: bedrock.model("anthropic.claude-3-5-sonnet-20241022-v2:0"),
        prompt: "Question",
      })
      const error = yield* Effect.flip(PromptCache.apply(request, { cache_control: { type: "ephemeral", ttl: "1h" } }))
      expect(error.reason._tag).toBe("InvalidRequest")
      const configured = yield* PromptCache.apply(request, { cache_control: { type: "ephemeral", ttl: "5m" } })
      expect((yield* compileRequest(configured)).body).toMatchObject({
        messages: [{ content: [{ text: "Question" }, { cachePoint: { type: "default" } }] }],
      })
    }),
  )

  it.effect("rejects explicit cache controls on implicitly cached gateway models", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        PromptCache.apply(
          LLM.request({
            model: OpenRouter.configure({ apiKey: "test" }).model("openai/gpt-5.6"),
          }),
          { cache_control: { type: "ephemeral" } },
        ),
      )
      expect(error.reason._tag).toBe("InvalidRequest")
    }),
  )

  it.effect("rejects OpenAI controls on an Anthropic route", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        PromptCache.apply(LLM.request({ model: AnthropicMessages.route.model({ id: "claude" }) }), {
          prompt_cache_options: { ttl: "30m" },
        }),
      )
      expect(error.reason._tag).toBe("InvalidRequest")
    }),
  )
})

for (const options of [
  { prompt_cache_retention: "24h" },
  { prompt_cache_options: { mode: "implicit", ttl: "30m" }, prompt_cache_retention: "24h" },
] as const) {
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toBe("/v1/responses/compact")
        expect(JSON.parse(text)).toMatchObject(options)
        return respond(
          JSON.stringify({
            object: "response.compaction",
            output: [{ type: "compaction", id: "cmp_cache", encrypted_content: "opaque" }],
          }),
        )
      }),
    ),
  ).effect(`preserves native compaction cache options: ${JSON.stringify(options)}`, () =>
    Effect.gen(function* () {
      const request = yield* PromptCache.apply(
        LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.6"), prompt: "Question" }),
        options,
      )
      yield* LLMClient.compact(request)
    }),
  )
}
