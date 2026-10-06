import { expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMClient, LLMEvent, Media, Message, SystemPart, isRetryable } from "../../src/index.js"
import { Cohere } from "../../src/providers/cohere.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const cohere = Cohere.configure({ apiKey: "fixture" })

test("Cohere exposes native and compatible endpoints without Core remapping", () => {
  expect(cohere.model("command-a-03-2025").route.endpoint.baseURL).toBe("https://api.cohere.com/v2")
  expect(cohere.chat("command-a-03-2025").route.endpoint.baseURL).toBe("https://api.cohere.ai/compatibility/v1")
  expect(
    Cohere.model("command-a-03-2025", { apiKey: "fixture", headers: { "X-Test": "yes" }, body: { temperature: 0 } })
      .route.defaults?.http,
  ).toMatchObject({ body: { temperature: 0 } })
})

it.effect("Cohere lowers native history, thinking, tools, and sampling", () =>
  Effect.gen(function* () {
    const prepared = yield* compileRequest(
      LLM.request({
        model: cohere.model("command-a-reasoning-08-2025"),
        system: [SystemPart.make("Be concise.\nKeep this newline."), SystemPart.make("Second instructions.")],
        messages: [
          Message.user("Lookup Paris"),
          Message.assistant([{ type: "tool-call", id: "lookup-1", name: "lookup", input: { city: "Paris" } }]),
          Message.tool({ id: "lookup-1", name: "lookup", result: { sunny: true } }),
        ],
        tools: [{ name: "lookup", description: "Look up a city", inputSchema: { type: "object", properties: {} } }],
        toolChoice: "required",
        providerOptions: { thinking: { tokenBudget: 128 } },
        generation: { maxTokens: 2048, topP: 0.9, topK: 10 },
      }),
    )
    expect(prepared.body).toMatchObject({
      model: "command-a-reasoning-08-2025",
      stream: true,
      p: 0.9,
      k: 10,
      max_tokens: 2048,
      thinking: { type: "enabled", token_budget: 128 },
      tool_choice: "REQUIRED",
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "Be concise.\nKeep this newline." },
            { type: "text", text: "Second instructions." },
          ],
        },
        { role: "user", content: [{ type: "text", text: "Lookup Paris" }] },
        {
          role: "assistant",
          tool_calls: [{ id: "lookup-1", function: { name: "lookup", arguments: '{"city":"Paris"}' } }],
        },
        { role: "tool", tool_call_id: "lookup-1", content: '{"sunny":true}' },
      ],
    })
  }),
)

it.effect("Cohere compatibility omits unsupported OpenAI fields", () =>
  Effect.gen(function* () {
    const prepared = yield* compileRequest(
      LLM.request({
        model: cohere.chat("command-a-reasoning-08-2025"),
        prompt: "Hello",
        providerOptions: { reasoningEffort: "high" },
        generation: { maxTokens: 64 },
      }),
    )
    expect(prepared.body).toMatchObject({ reasoning_effort: "high", max_tokens: 64, stream: true })
    expect(prepared.body.stream_options).toEqual({ include_usage: true })
    for (const key of ["store", "max_completion_tokens", "parallel_tool_calls", "prompt_cache_key"])
      expect(prepared.body[key]).toBeUndefined()
  }),
)

it.effect("Cohere maps inclusive usage while retaining distinct billed units", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(
      LLM.request({ model: cohere.model("command-a-03-2025"), prompt: "Hi" }),
    ).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(
            { type: "message-start" },
            { type: "content-start", index: 0, delta: { message: { content: { type: "thinking", thinking: "" } } } },
            { type: "content-delta", index: 0, delta: { message: { content: { thinking: "Think" } } } },
            { type: "content-end", index: 0 },
            { type: "content-start", index: 1, delta: { message: { content: { type: "text", text: "" } } } },
            { type: "content-delta", index: 1, delta: { message: { content: { text: "OK" } } } },
            { type: "content-end", index: 1 },
            {
              type: "message-end",
              delta: {
                finish_reason: "COMPLETE",
                usage: {
                  tokens: { input_tokens: 100, output_tokens: 20, reasoning_tokens: 10 },
                  billed_units: { input_tokens: 30, output_tokens: 15 },
                  cached_tokens: 60,
                },
              },
            },
          ),
        ),
      ),
    )
    expect(response.text).toBe("OK")
    expect(response.reasoning).toBe("Think")
    expect(response.usage).toMatchObject({
      inputTokens: 100,
      nonCachedInputTokens: 40,
      cacheReadInputTokens: 60,
      outputTokens: 20,
      reasoningTokens: 10,
      totalTokens: 120,
      providerMetadata: { cohere: { billed_units: { input_tokens: 30, output_tokens: 15 } } },
    })
    expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
  }),
)

it.effect("Cohere rejects incomplete streams", () =>
  Effect.gen(function* () {
    const error = yield* LLMClient.generate(
      LLM.request({ model: cohere.model("command-a-03-2025"), prompt: "Hi" }),
    ).pipe(Effect.provide(fixedResponse(sseEvents({ type: "message-start" }))), Effect.flip)
    expect(error.message).toContain("without message-end")
  }),
)

it.effect("Cohere preserves native tool plans in continued history", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(
      LLM.request({ model: cohere.model("command-a-03-2025"), prompt: "Hi" }),
    ).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(
            { type: "message-start" },
            { type: "tool-plan-delta", delta: { message: { tool_plan: "Look up the weather." } } },
            {
              type: "tool-call-start",
              index: 0,
              delta: { message: { tool_calls: { id: "lookup-1", function: { name: "lookup", arguments: "" } } } },
            },
            {
              type: "tool-call-delta",
              index: 0,
              delta: { message: { tool_calls: { function: { arguments: '{"city":"Paris"}' } } } },
            },
            { type: "tool-call-end", index: 0 },
            { type: "message-end", delta: { finish_reason: "TOOL_CALL" } },
          ),
        ),
      ),
    )
    expect(response.toolCalls[0]?.input).toEqual({ city: "Paris" })
    const prepared = yield* compileRequest(
      LLM.request({
        model: cohere.model("command-a-03-2025"),
        messages: [response.message, Message.tool({ id: "lookup-1", name: "lookup", result: { sunny: true } })],
      }),
    )
    expect(prepared.body.messages).toMatchObject([
      { role: "assistant", tool_plan: "Look up the weather.", tool_calls: [{ id: "lookup-1" }] },
      { role: "tool", tool_call_id: "lookup-1" },
    ])
  }),
)

it.effect("Cohere rejects unsupported media instead of silently dropping it", () =>
  Effect.gen(function* () {
    const error = yield* compileRequest(
      LLM.request({
        model: cohere.model("command-a-03-2025"),
        messages: [Message.user([{ type: "media", media: Media.base64("Zm9v", "audio/wav") }])],
      }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidRequest")
  }),
)

it.effect("Cohere thinking budgets must be positive integers", () =>
  Effect.gen(function* () {
    const error = yield* compileRequest(
      LLM.request({
        model: cohere.model("command-a-reasoning-08-2025"),
        providerOptions: { thinking: { tokenBudget: 0 } },
      }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidRequest")
  }),
)

it.effect("Cohere fits thinking budgets under the output limit", () =>
  Effect.gen(function* () {
    const prepared = yield* compileRequest(
      LLM.request({
        model: cohere.model("command-a-reasoning-08-2025"),
        prompt: "Hi",
        providerOptions: { thinking: { tokenBudget: 31_999 } },
        generation: { maxTokens: 4096 },
      }),
    )
    expect(prepared.body.thinking).toEqual({ type: "enabled", token_budget: 2048 })
  }),
)

// Bodies captured live on 2026-10-02, except 402 and 429, which are Cohere's documented messages.
const errors = [
  { status: 401, message: "Incorrect API key provided: ***-123.", tag: "Authentication", retry: false },
  { status: 404, message: "model 'no-such-model-xyz' not found", tag: "InvalidRequest", retry: false },
  {
    status: 400,
    message: "invalid request: temperature must be between 0 and 2.0 inclusive.",
    tag: "InvalidRequest",
    retry: false,
  },
  {
    status: 400,
    error_type: "TOO_MANY_TOKENS",
    message: "too many tokens: size limit exceeded by 168512 tokens. The limit for this model is 132000 tokens.",
    tag: "InvalidRequest",
    classification: "context-overflow",
    retry: false,
  },
  {
    status: 400,
    error_type: "TOO_MANY_TOKENS",
    message:
      "too many tokens: max tokens must be less than or equal to 4096, the maximum output length for this model - received 1000000.",
    tag: "InvalidRequest",
    retry: false,
  },
  { status: 402, message: "Please add or update your payment method to continue", tag: "QuotaExceeded", retry: false },
  {
    status: 429,
    message: "You are using a Trial key, which is limited to 40 API calls / minute.",
    tag: "RateLimit",
    retry: true,
  },
  { status: 500, message: "internal server error", tag: "ProviderInternal", retry: true },
]

it.effect("Cohere HTTP errors map to AI error reasons", () =>
  Effect.forEach(errors, (item) =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(
        LLM.request({ model: cohere.model("command-a-03-2025"), prompt: "Hi" }),
      ).pipe(
        Effect.provide(
          fixedResponse(JSON.stringify({ id: "fixture", error_type: item.error_type, message: item.message }), {
            status: item.status,
            headers: { "content-type": "application/json" },
          }),
        ),
        Effect.flip,
      )
      expect({
        message: error.message,
        tag: error.reason._tag,
        classification: error.reason._tag === "InvalidRequest" ? error.reason.classification : undefined,
        retry: isRetryable(error),
      }).toEqual({ message: item.message, tag: item.tag, classification: item.classification, retry: item.retry })
    }),
  ),
)
