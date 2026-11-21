import { expect } from "bun:test"
import { ConfigProvider, Effect, Stream } from "effect"
import { ai, CacheHint, LanguageModel, LLMClient, LLMEvent, Message, Usage } from "../../src/effect.js"
import { VercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents, sseRaw } from "../lib/sse.js"
import { isRetryable } from "../../src/provider-error.js"

it.effect("Gateway defaults preserve full model IDs and select the requested families", () =>
  Effect.gen(function* () {
    const gateway = VercelAIGateway.configure({ apiKey: "fixture" })
    for (const [id, path] of [
      ["openai/gpt-6.1", "/responses"],
      ["meta/muse-spark-1.3", "/chat/completions"],
      ["spacexai/grok-4.7", "/responses"],
      ["meta/llama-4", "/messages"],
      ["openai/gpt-oss-120b", "/responses"],
      ["anthropic/claude-sonnet-5.5", "/messages"],
      ["google/gemini-3.8-flash", "/messages"],
      ["moonshotai/kimi-k3", "/messages"],
      ["deepseek/deepseek-v4.1-flash", "/messages"],
    ]) {
      const model = gateway.model(id)
      expect(model.id).toBe(id)
      expect(model.provider).toBe("vercel-ai-gateway")
      expect(model.route.endpoint.path).toBe(path)
      const compiled = yield* compileRequest(ai.request({ model, prompt: "Hello" }))
      expect(compiled.body.model).toBe(id)
      expect(compiled.body.providerOptions).toBeUndefined()
    }
  }),
)

it.effect("Gateway Messages applies inline cache markers only for Anthropic and Qwen models", () =>
  Effect.gen(function* () {
    const gateway = VercelAIGateway.configure({ apiKey: "fixture" })
    const input = {
      system: "System prompt",
      tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
      prompt: "Hello",
    }
    const claude = yield* compileRequest(
      ai.request({ ...input, model: gateway.messages("anthropic/claude-sonnet-5.5") }),
    )
    expect(claude.body).toMatchObject({
      tools: [{ name: "lookup", cache_control: { type: "ephemeral" } }],
      system: [{ type: "text", text: "System prompt", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] }],
    })
    const qwen = yield* compileRequest(ai.request({ ...input, model: gateway.messages("alibaba/qwen3.8-max") }))
    expect(qwen.body).toMatchObject({
      tools: [{ name: "lookup", cache_control: undefined }],
      system: [{ type: "text", text: "System prompt", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] }],
    })
    const gemini = yield* compileRequest(ai.request({ ...input, model: gateway.messages("google/gemini-3.8-flash") }))
    expect(JSON.stringify(gemini.body)).not.toContain("cache_control")
  }),
)

it.effect("Gateway keeps distinct system blocks, cache hints, and upstream-scoped controls", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      ai.request({
        model: VercelAIGateway.configure({ apiKey: "fixture" }).messages("anthropic/claude-sonnet-5.5"),
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
      ai.request({ model: gateway.messages("anthropic/claude-sonnet-5.5"), prompt: "Hello" }),
    )
    expect(messages.body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })
    const responses = yield* compileRequest(
      ai.request({ model: gateway.responses("openai/gpt-6-luna"), prompt: "Hello" }),
    )
    expect(responses.body).toMatchObject({
      reasoning: { effort: "high" },
      store: false,
      include: ["reasoning.encrypted_content"],
    })
    const chat = yield* compileRequest(ai.request({ model: gateway.chat("google/gemini-3.8-flash"), prompt: "Hello" }))
    expect(chat.body).toMatchObject({ reasoning_effort: "high" })
  }),
)

it.effect("Gateway Responses keeps cache-key and cache controls out of upstream namespaces", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      ai.request({
        model: VercelAIGateway.configure({ apiKey: "fixture" }).responses("openai/gpt-6-luna"),
        prompt: "Hello",
        promptCacheKey: "opaque-session",
        providerOptions: { cacheTTL: "1h", cacheAnchorItems: 1 },
      }),
    )
    expect(compiled.body).toMatchObject({ prompt_cache_key: "opaque-session", cache_ttl: "1h", cache_anchor_items: 1 })
    expect(compiled.body.providerOptions).toBeUndefined()
  }),
)

it.effect("Gateway Messages preserves signatures and billing metadata through tool continuation", () =>
  Effect.gen(function* () {
    const model = VercelAIGateway.configure({ apiKey: "fixture" }).messages("anthropic/claude-sonnet-5.5")
    const response = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
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
      ai.request({
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
    const model = VercelAIGateway.configure({ apiKey: "fixture" }).responses("openai/gpt-6-luna")
    const response = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
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
    const compiled = yield* compileRequest(ai.request({ model, messages: [Message.user("Hello"), response.message] }))
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
      const error = yield* LLMClient.generate(
        ai.request({
          model: VercelAIGateway.configure({ apiKey: "fixture" }).chat("openai/gpt-6-luna"),
          prompt: "Hello",
        }),
      ).pipe(
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
        Effect.flip,
      )
      expect(error.reason.http?.status).toBe(status)
      expect(isRetryable(error)).toBe(false)
    }
  }),
)

it.effect("Gateway authentication supports OIDC fallback and affinity without reading session state", () =>
  Effect.gen(function* () {
    for (const api of ["messages", "responses", "chat"] as const) {
      yield* LLMClient.generate(
        ai.request({
          model: VercelAIGateway.configure()[api]("openai/gpt-6-luna"),
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

const gatewayResponseBody = (input: {
  readonly id: string
  readonly cost: string | number
  readonly usage?: Readonly<Record<string, unknown>>
}) =>
  sseEvents(
    {
      type: "response.completed",
      response: {
        id: input.id,
        output: [],
        service_tier: "priority",
        ...(input.usage ? { usage: input.usage } : {}),
        provider_metadata: {
          gateway: { cost: input.cost, generationId: "gen_resp_1", routing: { finalProvider: "openai" } },
        },
      },
    },
  )

it.effect(
  "Gateway Messages attaches gateway metadata, parsed string cost, and preserves visibleOutputTokens on step-finish and finish",
  () =>
    Effect.gen(function* () {
      const expectedGateway = {
        generationId: "gen_msg_1",
        cost: "0.0207155",
        routing: { finalProvider: "anthropic" },
      }
      const response = yield* LLMClient.generate(
        ai.request({
          model: VercelAIGateway.configure({ apiKey: "fixture" }).messages("anthropic/claude-sonnet-5.5"),
          prompt: "Hello",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() =>
              input.respond(
                sseEvents(
                  {
                    type: "message_start",
                    message: {
                      usage: { input_tokens: 10, output_tokens: 0 },
                      provider_metadata: { gateway: { generationId: "gen_msg_1" } },
                    },
                  },
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
                  { type: "content_block_stop", index: 0 },
                  {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn", stop_sequence: "</done>" },
                    usage: { output_tokens: 12, output_tokens_details: { thinking_tokens: 2 } },
                    provider_metadata: {
                      gateway: { cost: "0.0207155", routing: { finalProvider: "anthropic" } },
                    },
                  },
                  { type: "message_stop" },
                ),
                { headers: { "content-type": "text/event-stream" } },
              ),
            ),
          ),
        ),
      )
      const terminal = response.events.filter((event) => LLMEvent.is.stepFinish(event) || LLMEvent.is.finish(event))
      expect(terminal).toHaveLength(2)
      for (const event of terminal) {
        expect(event.providerMetadata?.gateway).toEqual(expectedGateway)
        expect(event.providerMetadata?.["vercel-ai-gateway"]).toEqual({
          stopSequence: "</done>",
          gateway: expectedGateway,
        })
        expect(event.usage).toBeInstanceOf(Usage)
        expect(event.usage?.cost).toBe(0.0207155)
        expect(event.usage?.outputTokens).toBe(12)
        expect(event.usage?.reasoningTokens).toBe(2)
        expect(event.usage?.visibleOutputTokens).toBe(10)
        expect(event.usage?.providerMetadata?.["vercel-ai-gateway"]).toBeDefined()
      }
      expect(response.usage?.cost).toBe(0.0207155)
    }),
)

it.effect(
  "Gateway Responses merges gateway metadata with responseId/serviceTier and supports route providerMetadataKey override",
  () =>
    Effect.gen(function* () {
      const gateway = VercelAIGateway.configure({ apiKey: "fixture" })
      const run = (model: LanguageModel) =>
        LLMClient.stream(ai.request({ model, prompt: "Hello" })).pipe(
          Stream.runCollect,
          Effect.provide(
            dynamicResponse((input) =>
              Effect.sync(() =>
                input.respond(
                  gatewayResponseBody({
                    id: "resp_gw_1",
                    cost: "0.001",
                    usage: {
                      input_tokens: 10,
                      output_tokens: 5,
                      output_tokens_details: { reasoning_tokens: 2 },
                    },
                  }),
                  { headers: { "content-type": "text/event-stream" } },
                ),
              ),
            ),
          ),
        )
      const stepFinishOf = (events: Iterable<LLMEvent>) => {
        const stepFinish = Array.from(events).find(LLMEvent.is.stepFinish)
        if (stepFinish === undefined) throw new Error("Responses stream did not emit a step-finish event")
        return stepFinish
      }
      const stepFinish = stepFinishOf(yield* run(gateway.responses("openai/gpt-6-luna")))
      expect(stepFinish.providerMetadata?.["vercel-ai-gateway"]).toMatchObject({
        responseId: "resp_gw_1",
        serviceTier: "priority",
        gateway: { cost: "0.001", generationId: "gen_resp_1", routing: { finalProvider: "openai" } },
      })
      expect(stepFinish.usage?.visibleOutputTokens).toBe(3)
      expect(stepFinish.usage?.cost).toBe(0.001)

      const base = gateway.responses("openai/gpt-6-luna")
      const custom = LanguageModel.update(base, { route: base.route.with({ provider: "custom-gw" }) })
      const overridden = stepFinishOf(yield* run(custom))
      expect(overridden.providerMetadata?.["custom-gw"]?.gateway).toBeDefined()
    }),
)

it.effect(
  "Gateway Chat onHalt preserves numeric usage.cost over string gateway.cost and falls back to gateway.cost when usage.cost is absent",
  () =>
    Effect.gen(function* () {
      const run = (gateway: Readonly<Record<string, unknown>>, usage: Readonly<Record<string, unknown>>) => {
        const body = sseRaw(
          `data: ${JSON.stringify({ choices: [{ delta: { provider_metadata: { gateway } } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}`,
        )
        return LLMClient.stream(
          ai.request({
            model: VercelAIGateway.configure({ apiKey: "fixture" }).chat("meta/muse-spark-1.3"),
            prompt: "Hello",
          }),
        ).pipe(
          Stream.runCollect,
          Effect.provide(
            dynamicResponse((input) =>
              Effect.sync(() => input.respond(body, { headers: { "content-type": "text/event-stream" } })),
            ),
          ),
        )
      }
      const stepFinishOf = (events: Iterable<LLMEvent>) => {
        const stepFinish = Array.from(events).find(LLMEvent.is.stepFinish)
        if (stepFinish === undefined) throw new Error("Chat stream did not emit a step-finish event")
        return stepFinish
      }

      const preserved = stepFinishOf(
        yield* run(
          { cost: "0.99", routing: { finalProvider: "anthropic" } },
          { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
        ),
      )
      expect(preserved.usage?.cost).toBe(0)
      expect(preserved.providerMetadata?.["vercel-ai-gateway"]?.gateway).toMatchObject({
        routing: { finalProvider: "anthropic" },
      })

      const fallback = stepFinishOf(
        yield* run(
          { cost: "0.0042", routing: { finalProvider: "anthropic" } },
          { prompt_tokens: 10, completion_tokens: 5 },
        ),
      )
      expect(fallback.usage?.cost).toBe(0.0042)
    }),
)

it.effect(
  "Gateway cost parser accepts valid decimals and rejects empty, negative, or non-finite strings without coercing to zero",
  () =>
    Effect.gen(function* () {
      const costSource = (cost: string | number, index: number, withUsage: boolean) =>
        sseEvents(
          {
            type: "response.completed",
            response: {
              id: `resp_cost_${index}`,
              output: [],
              ...(withUsage ? { usage: { input_tokens: 10, output_tokens: 5 } } : {}),
              provider_metadata: { gateway: { cost, routing: { finalProvider: "openai" } } },
            },
          },
        )
      const stepFinishFor = (body: string) =>
        Effect.gen(function* () {
          const events = yield* LLMClient.stream(
            ai.request({
              model: VercelAIGateway.configure({ apiKey: "fixture" }).responses("openai/gpt-6-luna"),
              prompt: "Hello",
            }),
          ).pipe(
            Stream.runCollect,
            Effect.provide(
              dynamicResponse((input) =>
                Effect.sync(() => input.respond(body, { headers: { "content-type": "text/event-stream" } })),
              ),
            ),
          )
          const stepFinish = Array.from(events).find(LLMEvent.is.stepFinish)
          if (stepFinish === undefined) throw new Error("Responses stream did not emit a step-finish event")
          return stepFinish
        })

      const valid = [
        { cost: "0", expected: 0 },
        { cost: "0.00", expected: 0 },
        { cost: " 0.5 ", expected: 0.5 },
        { cost: "1e-6", expected: 1e-6 },
        { cost: ".25", expected: 0.25 },
        { cost: 0, expected: 0 },
      ] as const
      for (const [index, item] of valid.entries()) {
        const stepFinish = yield* stepFinishFor(costSource(item.cost, index, true))
        expect(stepFinish.usage?.cost).toBe(item.expected)
      }

      const invalid = ["", "   ", "-0.01", -1, "NaN", "Infinity", "1e500", "0x10", "$0.02"] as const
      for (const [index, cost] of invalid.entries()) {
        const stepFinish = yield* stepFinishFor(costSource(cost, index, true))
        expect(stepFinish.usage).toBeInstanceOf(Usage)
        expect(stepFinish.usage?.inputTokens).toBe(10)
        expect(stepFinish.usage?.outputTokens).toBe(5)
        expect(stepFinish.usage?.cost).toBeUndefined()
        expect(stepFinish.providerMetadata?.["vercel-ai-gateway"]?.gateway).toMatchObject({
          routing: { finalProvider: "openai" },
        })
      }

      const withoutUsage = yield* stepFinishFor(costSource("0.01", 99, false))
      expect(withoutUsage.usage).toBeInstanceOf(Usage)
      expect(withoutUsage.usage?.cost).toBe(0.01)
    }),
)
