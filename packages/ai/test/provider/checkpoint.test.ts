import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM, LLMClient, LLMRequest } from "../../src/index.js"
import { Azure, OpenAI } from "../../src/providers.js"
import { testEffect } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
const request = LLM.request({ model: OpenAI.configure({ apiKey: "fixture" }).responses("fixture"), prompt: "hello" })
const trigger = { mechanism: "trigger" } as const

testEffect(
  dynamicResponse(({ request, text, respond }) =>
    Effect.sync(() => {
      expect(new URL(request.url).pathname).toBe("/v1/responses")
      expect(new URL(request.url).searchParams.get("trace")).toBe("request")
      expect(request.headers.authorization).toBe("Bearer fixture")
      expect(request.headers["chatgpt-account-id"]).toBe("fixture-account")
      expect(request.headers["x-codex-beta-features"]).toBe("remote_compaction_v2")
      const body = JSON.parse(text)
      expect(body).toMatchObject({
        model: "fixture",
        stream: true,
        store: false,
        instructions: "Keep the context",
        parallel_tool_calls: true,
        prompt_cache_key: "session-key",
        service_tier: "priority",
        reasoning: { effort: "high", summary: "auto" },
        prompt_cache_retention: "24h",
        prompt_cache_options: { mode: "session", ttl: "1h" },
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }, { type: "compaction_trigger" }],
      })
      expect(body.tools).toHaveLength(1)
      expect(body.tools[0].name).toBe("lookup")
      expect(body.tool_choice).toBeUndefined()
      expect(body.context_management).toBeUndefined()
      expect(body.text).toBeUndefined()
      expect(body.max_output_tokens).toBeUndefined()
      expect(body.previous_response_id).toBeUndefined()
      return respond(
        sseEvents({
          type: "response.completed",
          response: {
            id: "resp_1",
            output: [checkpoint],
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 40 },
              output_tokens: 5,
              total_tokens: 105,
            },
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }),
  ),
).effect("trigger uses normal request preparation, configured deployment, and supplied subscription headers", () =>
  Effect.gen(function* () {
    const calls: string[] = []
    const input = LLM.request({
      model: request.model,
      system: "Keep the context",
      prompt: "hello",
      promptCacheKey: "session-key",
      tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
      toolChoice: { type: "tool", name: "lookup" },
      generation: { maxTokens: 1 },
      providerOptions: {
        store: true,
        reasoningEffort: "high",
        reasoningSummary: "auto",
        contextManagement: [{ type: "compaction" }],
      },
      http: {
        headers: { "chatgpt-account-id": "fixture-account", "x-codex-beta-features": "remote_compaction_v2" },
        query: { trace: "request" },
        body: {
          service_tier: "priority",
          prompt_cache_retention: "24h",
          prompt_cache_options: { mode: "session", ttl: "1h" },
          store: true,
          stream: false,
          text: { format: { type: "json_object" } },
          tool_choice: "required",
        },
      },
    })
    const original = LLMRequest.input(input)
    const result = yield* LLMClient.compact(input, {
      ...trigger,
      http: (request, next) => {
        calls.push("http")
        return next(request)
      },
    })
    expect(result.checkpoint).toMatchObject({
      type: "compaction",
      provider: "openai",
      id: "cmp_1",
      encrypted: "opaque",
    })
    expect(result.responseID).toBe("resp_1")
    expect(result.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cacheReadInputTokens: 40,
    })
    expect(LLMRequest.input(input)).toEqual(original)
    expect(calls).toEqual(["http"])
  }),
)

const idless = { type: "compaction", encrypted_content: "opaque" }
testEffect(
  fixedResponse(
    sseEvents(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", id: "fc_1", name: "unexpected", arguments: "not JSON" },
      },
      { type: "response.output_text.delta", delta: "do not expose this" },
      { type: "response.output_item.added", output_index: 1, item: { type: "compaction" } },
      { type: "response.output_item.done", output_index: 1, item: idless },
      { type: "response.output_item.done", output_index: 1, item: idless },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          output: [{ type: "function_call", id: "fc_1", name: "unexpected", arguments: "not JSON" }, idless],
        },
      },
    ),
  ),
).effect("correlates an ID-less checkpoint across repeated events and ignores other output", () =>
  Effect.gen(function* () {
    const result = yield* LLMClient.compact(request, trigger)
    expect(result.checkpoint.encrypted).toBe("opaque")
    expect(result.checkpoint.id).toBeString()
    expect("message" in result).toBe(false)
  }),
)

for (const [name, events] of Object.entries({
  missing: [{ type: "response.completed", response: { id: "resp_1", output: [] } }],
  multiple: [
    { type: "response.completed", response: { id: "resp_1", output: [checkpoint, { ...checkpoint, id: "cmp_2" }] } },
  ],
  duplicateSlots: [{ type: "response.completed", response: { id: "resp_1", output: [checkpoint, checkpoint] } }],
  malformed: [
    { type: "response.completed", response: { id: "resp_1", output: [{ type: "compaction", id: "cmp_1" }] } },
  ],
  noResponseID: [{ type: "response.completed", response: { output: [checkpoint] } }],
  incomplete: [
    { type: "response.output_item.done", item: checkpoint },
    { type: "response.incomplete", response: { id: "resp_1", incomplete_details: { reason: "max_output_tokens" } } },
  ],
  failed: [
    { type: "response.output_item.done", item: checkpoint },
    { type: "response.failed", response: { id: "resp_1", error: { code: "server_error", message: "failed" } } },
  ],
})) {
  const wire = events.map((event) => ({ ...event, fixture_extra: "preserved" }))
  testEffect(
    fixedResponse(sseEvents(...wire), { headers: { "content-type": "text/event-stream", "x-fixture": "preserved" } }),
  ).effect(`rejects ${name} checkpoint response and preserves original error context`, () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.compact(request, trigger).pipe(Effect.flip)
      expect(error.reason.body).toBe(JSON.stringify(wire.at(-1)))
      expect(error.reason.http).toMatchObject({ status: 200, headers: { "x-fixture": "preserved" } })
    }),
  )
}

testEffect(fixedResponse(sseEvents({ type: "response.output_item.done", item: checkpoint }))).effect(
  "rejects clean EOF without response.completed",
  () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.compact(request, trigger).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
    }),
)
for (const body of [{ input: [] }, { previous_response_id: "stale" }]) {
  testEffect(dynamicResponse(() => Effect.die("Must reject before sending"))).effect(
    `rejects caller-supplied ${Object.keys(body)[0]} before sending trigger`,
    () =>
      Effect.gen(function* () {
        const error = yield* LLMClient.compact(LLMRequest.update(request, { http: { body } }), trigger).pipe(
          Effect.flip,
        )
        expect(error.reason._tag).toBe("InvalidRequest")
      }),
  )
}

testEffect(dynamicResponse(() => Effect.die("Must reject before sending"))).effect(
  "endpoint support does not grant trigger support, including for untyped callers",
  () =>
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      const unsupported = LLM.request({ model: Azure.configure({ resourceName: "fixture" }).responses("fixture") })
      expect(LLMClient.canCompact(unsupported)).toBe(true)
      expect(LLMClient.canCompact(unsupported, trigger)).toBe(false)
      // @ts-expect-error Exercise untyped consumers; the service must reject before sending.
      const serviceError = yield* client.compact(unsupported, trigger).pipe(Effect.flip)
      expect(serviceError.reason._tag).toBe("UnsupportedOperation")
      // @ts-expect-error Exercise an unknown mechanism supplied by JavaScript.
      const error = yield* LLMClient.compact(request, { mechanism: "other" }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }),
)

testEffect(fixedResponse("must not use HTTP")).effect(
  "invalid checkpoint output is rejected before acknowledging channel completion",
  () =>
    Effect.gen(function* () {
      let completed = 0
      const operation = LLMClient.compact(request, {
        mechanism: "trigger",
        webSocket: {
          execute: () =>
            Effect.succeed({
              frames: Stream.make(
                JSON.stringify({
                  type: "response.completed",
                  response: { id: "resp_1", output: [] },
                }),
              ),
              complete: Effect.sync(() => {
                completed++
              }),
            }),
        },
      })
      const error = yield* operation.pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(completed).toBe(0)
    }),
)
