import { expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { LLM, LLMClient, LLMEvent, Message, CacheHint } from "../../src/index.js"
import { VercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"
import { isRetryable } from "../../src/provider-error.js"

it.effect("Gateway defaults preserve full model IDs and select the requested families", () =>
  Effect.gen(function* () {
    const gateway = VercelAIGateway.configure({ apiKey: "fixture" })
    for (const [id, path] of [
      ["openai/gpt-6.1", "/responses"],
      ["meta/muse-spark-1.3", "/responses"],
      ["xai/grok-4", "/responses"],
      ["meta/llama-4", "/messages"],
      ["openai/gpt-oss-120b", "/responses"],
      ["anthropic/claude-sonnet-4.6", "/messages"],
      ["google/gemini-2.5-flash", "/messages"],
      ["moonshotai/kimi-k3", "/messages"],
    ]) {
      const model = gateway.model(id)
      expect(model.id).toBe(id)
      expect(model.provider).toBe("vercel-ai-gateway")
      expect(model.route.endpoint.path).toBe(path)
      const compiled = yield* compileRequest(LLM.request({ model, prompt: "Hello" }))
      expect(compiled.body.model).toBe(id)
      expect(compiled.body.providerOptions).toEqual({ gateway: { caching: "auto" } })
    }
  }),
)

it.effect("Gateway keeps distinct system blocks, cache hints, and upstream-scoped controls", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      LLM.request({
        model: VercelAIGateway.configure({ apiKey: "fixture" }).messages("anthropic/claude-sonnet-4.6"),
        system: [
          { type: "text", text: "Stable", cache: new CacheHint({ type: "ephemeral" }) },
          { type: "text", text: "Project" },
        ],
        prompt: "Hello",
        cache: "none",
        providerOptions: {
          gateway: { only: ["anthropic", "bedrock"], order: ["bedrock"], zeroDataRetention: true },
          upstream: {
            anthropic: { thinking: { type: "adaptive" } },
            bedrock: { reasoningConfig: { type: "adaptive" } },
          },
        },
      }),
    )
    expect(compiled.body.system).toEqual([
      { type: "text", text: "Stable", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Project" },
    ])
    expect(compiled.body.providerOptions).toEqual({
      gateway: { only: ["anthropic", "bedrock"], order: ["bedrock"], zeroDataRetention: true },
      anthropic: { thinking: { type: "adaptive" } },
      bedrock: { reasoningConfig: { type: "adaptive" } },
    })
  }),
)

it.effect("Gateway effort settings lower to the selected API", () =>
  Effect.gen(function* () {
    const gateway = VercelAIGateway.configure({ apiKey: "fixture", providerOptions: { reasoningEffort: "high" } })
    const messages = yield* compileRequest(
      LLM.request({ model: gateway.messages("anthropic/claude-sonnet-4.6"), prompt: "Hello" }),
    )
    expect(messages.body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })
    const responses = yield* compileRequest(
      LLM.request({ model: gateway.responses("openai/gpt-5-nano"), prompt: "Hello" }),
    )
    expect(responses.body).toMatchObject({
      reasoning: { effort: "high" },
      store: false,
      include: ["reasoning.encrypted_content"],
    })
    const chat = yield* compileRequest(LLM.request({ model: gateway.chat("google/gemini-2.5-flash"), prompt: "Hello" }))
    expect(chat.body).toMatchObject({ reasoning_effort: "high" })
  }),
)

it.effect("Gateway Responses keeps cache-key and cache controls out of upstream namespaces", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      LLM.request({
        model: VercelAIGateway.configure({ apiKey: "fixture" }).responses("openai/gpt-5-nano"),
        prompt: "Hello",
        promptCacheKey: "opaque-session",
        providerOptions: { cacheTTL: "1h", cacheAnchorItems: 1 },
      }),
    )
    expect(compiled.body).toMatchObject({ prompt_cache_key: "opaque-session", cache_ttl: "1h", cache_anchor_items: 1 })
    expect(compiled.body.providerOptions).toEqual({ gateway: { caching: "auto" } })
  }),
)

it.effect("Gateway Messages preserves signatures and billing metadata through tool continuation", () =>
  Effect.gen(function* () {
    const model = VercelAIGateway.configure({ apiKey: "fixture" }).messages("anthropic/claude-sonnet-4.6")
    const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.sync(() => {
            expect(input.request.url).toBe("https://ai-gateway.vercel.sh/v1/messages")
            expect(input.request.headers.authorization).toBe("Bearer fixture")
            return input.respond(
              sseEvents(
                {
                  type: "message_start",
                  message: { usage: { input_tokens: 10, cache_read_input_tokens: 20 } },
                },
                {
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "thinking", thinking: "Plan", signature: "signed-state" },
                },
                { type: "content_block_stop", index: 0 },
                {
                  type: "content_block_start",
                  index: 1,
                  content_block: { type: "tool_use", id: "tool_1", name: "lookup", input: {} },
                },
                { type: "content_block_stop", index: 1 },
                {
                  type: "message_delta",
                  delta: { stop_reason: "tool_use" },
                  usage: { output_tokens: 5 },
                  provider_metadata: { gateway: { cost: "0.001", routing: { finalProvider: "bedrock" } } },
                },
                { type: "message_stop" },
              ),
              { headers: { "content-type": "text/event-stream" } },
            )
          }),
        ),
      ),
    )
    expect(response.events.find(LLMEvent.is.finish)?.providerMetadata?.gateway).toMatchObject({
      cost: "0.001",
      routing: { finalProvider: "bedrock" },
    })
    expect(response.usage?.cacheReadInputTokens).toBe(20)
    const compiled = yield* compileRequest(
      LLM.request({
        model,
        messages: [
          Message.user("Hello"),
          response.message,
          Message.tool({ id: "tool_1", name: "lookup", result: { found: true } }),
        ],
      }),
    )
    expect(compiled.body.messages).toContainEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Plan", signature: "signed-state" },
        { type: "tool_use", id: "tool_1", name: "lookup", input: {} },
      ],
    })
  }),
)

it.effect("Gateway Responses replays encrypted reasoning alongside tool calls", () =>
  Effect.gen(function* () {
    const model = VercelAIGateway.configure({ apiKey: "fixture" }).responses("openai/gpt-5-nano")
    const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.sync(() =>
            input.respond(
              sseEvents(
                {
                  type: "response.output_item.done",
                  output_index: 0,
                  item: { type: "reasoning", id: "rs_1", encrypted_content: "opaque-state", summary: [] },
                },
                {
                  type: "response.output_item.done",
                  output_index: 1,
                  item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}" },
                },
                {
                  type: "response.completed",
                  response: {
                    id: "resp_1",
                    output: [],
                    usage: { input_tokens: 10, output_tokens: 5 },
                    provider_metadata: { gateway: { cost: "0.001" } },
                  },
                },
              ),
              { headers: { "content-type": "text/event-stream" } },
            ),
          ),
        ),
      ),
    )
    const compiled = yield* compileRequest(LLM.request({ model, messages: [Message.user("Hello"), response.message] }))
    expect(compiled.body.input).toContainEqual({
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "opaque-state",
      summary: [],
    })
    expect(compiled.body.input).toContainEqual({
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "lookup",
      arguments: "{}",
    })
  }),
)

it.effect("Gateway 401 and 403 failures are terminal and retain HTTP context", () =>
  Effect.gen(function* () {
    for (const status of [401, 403]) {
      const result = yield* LLMClient.generate(
        LLM.request({
          model: VercelAIGateway.configure({ apiKey: "fixture" }).chat("openai/gpt-5-nano"),
          prompt: "Hello",
        }),
      ).pipe(
        Effect.result,
        Effect.provide(
          dynamicResponse((input) =>
            Effect.succeed(
              input.respond(
                JSON.stringify({ error: { type: "authentication_error", message: "Invalid credentials" } }),
                { status, headers: { "content-type": "application/json" } },
              ),
            ),
          ),
        ),
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure.reason.http?.status).toBe(status)
        expect(isRetryable(result.failure)).toBe(false)
      }
    }
  }),
)

it.effect("Gateway authentication supports OIDC fallback and affinity without reading session state", () =>
  Effect.gen(function* () {
    for (const api of ["messages", "responses", "chat"] as const) {
      yield* LLMClient.generate(
        LLM.request({
          model: VercelAIGateway.configure()[api]("openai/gpt-5-nano"),
          prompt: "Hello",
          promptCacheKey: "opaque-session",
        }),
      ).pipe(
        Effect.result,
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.headers.authorization).toBe("Bearer oidc-fixture")
              expect(input.request.headers["x-session-affinity"]).toBe("opaque-session")
              return input.respond("{}", { status: 400, headers: { "content-type": "application/json" } })
            }),
          ),
        ),
      )
    }
  }).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ VERCEL_OIDC_TOKEN: "oidc-fixture" }),
    ),
  ),
)
