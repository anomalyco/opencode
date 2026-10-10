import { expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/http"
import { Auth, LLM, LLMClient, Message } from "../../src/index.js"
import { OpenAI, Venice } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = Venice.configure({ apiKey: "fixture" }).chat("fixture-model")
const frame = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  choices: [{ delta, finish_reason }],
})

it.effect("Venice owns its endpoint, environment auth, aliases, and SDK-compatible prompt default", () =>
  Effect.gen(function* () {
    expect(Venice.provider.model).toBe(Venice.provider.chat)
    const selected = Venice.chat("qwen3-6-27b")
    const request = LLM.request({ model: selected, prompt: "Hello", promptCacheKey: "session-123" })
    const compiled = yield* compileRequest(request)
    const url = Endpoint.render(selected.route.endpoint, { request, body: compiled.body }).toString()
    expect(url).toBe("https://api.venice.ai/api/v1/chat/completions")
    expect(selected.provider).toBe("venice")
    expect(compiled.body.venice_parameters).toEqual({ include_venice_system_prompt: false })
    expect(compiled.body.prompt_cache_key).toBe("session-123")
    expect(compiled.body.store).toBeUndefined()
    expect(compiled.body.stream_options).toEqual({ include_usage: true })
    const headers = yield* selected.route.auth.apply({
      request,
      method: "POST",
      url,
      body: "{}",
      headers: Headers.empty,
    })
    expect(headers.authorization).toBe("Bearer fixture")
    const custom = Venice.configure({
      baseURL: "https://gateway.example/v1",
      queryParams: { deployment: "private" },
      auth: Auth.header("x-key", "fixture"),
    }).chat("qwen3-6-27b")
    expect(Endpoint.render(custom.route.endpoint, { request, body: compiled.body }).toString()).toBe(
      "https://gateway.example/v1/chat/completions?deployment=private",
    )
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { VENICE_API_KEY: "fixture" } })))),
)

it.effect("Venice lowers typed options, model defaults, and explicit reasoning overrides", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      LLM.request({
        model: Venice.configure({ apiKey: "fixture", providerOptions: { reasoningEffort: "low" } }).model(
          "qwen3-6-27b",
        ),
        generation: { maxTokens: 200, topK: 20 },
        providerOptions: {
          reasoningEffort: "future-effort",
          reasoning: { effort: "high", enabled: true, summary: "concise" },
          veniceParameters: { includeVeniceSystemPrompt: true, enableWebSearch: "auto", stripThinkingResponse: false },
          parallelToolCalls: false,
          maxCompletionTokens: 123,
          minP: 0.1,
          repetitionPenalty: 1.1,
          stopTokenIds: [12],
          promptCacheRetention: "24h",
          logprobs: true,
          topLogprobs: 2,
          minTemp: 0.1,
          maxTemp: 1.5,
          responseFormat: { type: "json_object" },
          user: "user-123",
        },
      }),
    )
    expect(compiled.body).toMatchObject({
      max_completion_tokens: 123,
      top_k: 20,
      min_p: 0.1,
      repetition_penalty: 1.1,
      reasoning: { effort: "future-effort", enabled: true, summary: "concise" },
      venice_parameters: {
        include_venice_system_prompt: true,
        enable_web_search: "auto",
        strip_thinking_response: false,
      },
      parallel_tool_calls: false,
      stop_token_ids: [12],
      prompt_cache_retention: "24h",
      logprobs: true,
      top_logprobs: 2,
      min_temp: 0.1,
      max_temp: 1.5,
      response_format: { type: "json_object" },
      user: "user-123",
    })
    expect(compiled.body.reasoning_effort).toBeUndefined()
    expect(compiled.body.max_tokens).toBeUndefined()
    expect(
      (yield* compileRequest(LLM.request({ model, providerOptions: { reasoning: { enabled: false } } }))).body
        .reasoning,
    ).toEqual({ enabled: false })
    expect(
      (yield* compileRequest(LLM.request({ model, cache: "none", promptCacheKey: "session-123" }))).body
        .prompt_cache_key,
    ).toBeUndefined()
  }),
)

it.effect("Venice hides encrypted trailers across every marker split while preserving exact replay", () =>
  Effect.gen(function* () {
    const marker = "__ENCRYPTED_REASONING__"
    for (const split of Array.from({ length: marker.length + 1 }, (_, index) => index)) {
      const raw = `Visible summary\n${marker}id=rs_123\nopaque-payload`
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              frame({ reasoning_content: `Visible summary\n${marker.slice(0, split)}` }),
              frame({
                reasoning_content: `${marker.slice(split)}id=rs_123\nopaque-payload`,
                reasoning_details: [
                  {
                    type: "reasoning.encrypted",
                    data: "opaque-payload",
                    format: "openai-responses-v1",
                    id: "rs_123",
                    index: 0,
                  },
                ],
              }),
              frame({ content: "42" }, "stop"),
            ),
          ),
        ),
      )
      expect(response.reasoning).toBe("Visible summary\n")
      expect(
        response.events
          .filter((event) => event.type === "reasoning-delta")
          .map((event) => event.text)
          .join(""),
      ).toBe("Visible summary\n")
      const replay = yield* compileRequest(LLM.request({ model, messages: [Message.user("Hello"), response.message] }))
      expect(replay.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            reasoning_content: raw,
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "opaque-payload",
                format: "openai-responses-v1",
                id: "rs_123",
                index: 0,
              },
            ],
          }),
        ]),
      )
    }
  }),
)

it.effect("Venice preserves opaque-only reasoning and does not eat an incomplete marker prefix", () =>
  Effect.gen(function* () {
    for (const scalar of ["__ENCRYPTED_REASONING__opaque", "normal _", "normal __ENCRYPTED_"]) {
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(
          fixedResponse(sseEvents(frame({ reasoning_content: scalar }), frame({ content: "42" }, "stop"))),
        ),
      )
      expect(response.reasoning).toBe(scalar.startsWith("__ENCRYPTED_REASONING__") ? "" : scalar)
      const body = (yield* compileRequest(LLM.request({ model, messages: [response.message] }))).body
      expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ reasoning_content: scalar })]))
    }
  }),
)

it.effect("Venice encrypted trailers do not change the base OpenAI Chat protocol", () =>
  LLMClient.generate(
    LLM.request({ model: OpenAI.configure({ apiKey: "fixture" }).chat("gpt-4o"), prompt: "Hello" }),
  ).pipe(
    Effect.provide(
      fixedResponse(
        sseEvents(
          frame({ reasoning_content: "text __ENCRYPTED_REASONING__payload" }),
          frame({ content: "42" }, "stop"),
        ),
      ),
    ),
    Effect.tap((response) => Effect.sync(() => expect(response.reasoning).toBe("text __ENCRYPTED_REASONING__payload"))),
  ),
)

it.effect("Venice keeps late Gemini signatures attached to the correct parallel call", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Lookup" })).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(
            frame({
              tool_calls: [
                { index: 0, id: "call_0", function: { name: "lookup", arguments: '{"key":"A"}' } },
                { index: 1, id: "call_1", function: { name: "lookup", arguments: '{"key":"B"}' } },
              ],
            }),
            frame({ tool_calls: [{ index: 0, thought_signature: "signed-first-call" }] }),
            frame({}, "tool_calls"),
          ),
        ),
      ),
    )
    expect(response.toolCalls).toHaveLength(2)
    expect(response.toolCalls[0].providerMetadata?.venice?.thoughtSignature).toBe("signed-first-call")
    expect(response.toolCalls[1].providerMetadata?.venice?.thoughtSignature).toBeUndefined()
    const replay = yield* compileRequest(LLM.request({ model, messages: [Message.user("Lookup"), response.message] }))
    expect(replay.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_calls: [
            expect.objectContaining({ id: "call_0", thought_signature: "signed-first-call" }),
            expect.not.objectContaining({ thought_signature: expect.anything() }),
          ],
        }),
      ]),
    )
  }),
)

it.effect("Venice preserves message signatures even for identical answers and empty intervening messages", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(frame({ content: "42" }), frame({ thought_signature: "second-signature" }), frame({}, "stop")),
        ),
      ),
    )
    const request = LLM.request({
      model,
      messages: [
        Message.assistant([
          { type: "text", text: "42", providerMetadata: { venice: { messageThoughtSignature: "first-signature" } } },
        ]),
        Message.assistant(""),
        response.message,
      ],
    })
    expect((yield* compileRequest(request)).body.messages).toEqual([
      { role: "assistant", content: "42", thought_signature: "first-signature" },
      { role: "assistant", content: "42", thought_signature: "second-signature" },
    ])
  }),
)

it.effect("Venice merges signed Claude reasoning without losing its final signature", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(
            frame({
              reasoning_content: "Think ",
              reasoning_details: [{ type: "reasoning.text", text: "Think ", format: "anthropic-claude-v1", index: 0 }],
            }),
            frame({
              reasoning_content: "carefully",
              reasoning_details: [
                { type: "reasoning.text", text: "carefully", format: "anthropic-claude-v1", index: 0 },
              ],
            }),
            frame({
              reasoning_details: [
                {
                  type: "reasoning.text",
                  text: "",
                  signature: "claude-signature",
                  format: "anthropic-claude-v1",
                  index: 0,
                },
              ],
            }),
            frame({ content: "42" }, "stop"),
          ),
        ),
      ),
    )
    expect(response.reasoning).toBe("Think carefully")
    expect((yield* compileRequest(LLM.request({ model, messages: [response.message] }))).body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasoning_details: [
            {
              type: "reasoning.text",
              text: "Think carefully",
              signature: "claude-signature",
              format: "anthropic-claude-v1",
              index: 0,
            },
          ],
        }),
      ]),
    )
  }),
)

it.effect("Venice maps cache-write usage and retains the raw wire spelling", () =>
  LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
    Effect.provide(
      fixedResponse(
        sseEvents(frame({ content: "42" }, "stop"), {
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 40, cache_creation_input_tokens: 30 },
            completion_tokens_details: { reasoning_tokens: 10 },
          },
        }),
      ),
    ),
    Effect.tap((response) =>
      Effect.sync(() => {
        expect(response.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 20,
          nonCachedInputTokens: 30,
          cacheReadInputTokens: 40,
          cacheWriteInputTokens: 30,
          reasoningTokens: 10,
        })
        expect(response.usage?.providerMetadata?.venice).toMatchObject({
          prompt_tokens_details: { cache_creation_input_tokens: 30 },
        })
      }),
    ),
  ),
)

it.effect("Venice surfaces HTTP string errors and streaming validation details without losing the payload", () =>
  Effect.gen(function* () {
    const http = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(
        fixedResponse('{"error":"Specified model not found"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
      Effect.result,
    )
    expect(http._tag).toBe("Failure")
    if (http._tag === "Failure") expect(http.failure.message).toContain("Specified model not found")
    const payload = {
      error: "Invalid request parameters",
      issues: [{ message: "Unsupported value", path: ["reasoning", "effort"] }],
    }
    const streamed = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
      Effect.provide(fixedResponse(sseEvents(payload))),
      Effect.result,
    )
    expect(streamed._tag).toBe("Failure")
    if (streamed._tag === "Failure") {
      expect(streamed.failure.message).toContain("reasoning.effort: Unsupported value")
      expect(JSON.parse(streamed.failure.reason.body ?? "{}")).toEqual(payload)
    }
  }),
)
