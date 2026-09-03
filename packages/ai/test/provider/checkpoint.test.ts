import { expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { CompactionCheckpointResponse, LLM, LLMClient, LLMRequest, LanguageModel, SystemPart } from "../../src/index.js"
import { Anthropic, Azure, OpenAI, XAI } from "../../src/providers.js"
import { Route } from "../../src/route/client.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { testEffect } from "../lib/effect.js"
import { dynamicResponse, fixedResponse, scriptedResponses, truncatedStream } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
const request = LLM.request({ model: OpenAI.configure({ apiKey: "fixture" }).responses("fixture"), prompt: "hello" })
const trigger = { mechanism: "trigger" } as const

testEffect(
  dynamicResponse(({ request, text, respond }) =>
    Effect.sync(() => {
      expect(new URL(request.url).pathname).toBe("/v1/responses")
      expect(new URL(request.url).searchParams.get("deployment")).toBe("fixture")
      expect(new URL(request.url).searchParams.get("trace")).toBe("request")
      expect(request.headers.authorization).toBe("Bearer fixture")
      expect(request.headers["chatgpt-account-id"]).toBe("fixture-account")
      expect(request.headers["x-codex-beta-features"]).toBe("remote_compaction_v2")
      expect(request.headers["x-deployment"]).toBe("resolved")
      const body = JSON.parse(text)
      expect(body).toMatchObject({
        model: "fixture",
        stream: true,
        store: false,
        instructions: "system\noperator",
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
    const route = Route.make({
      id: "fixture-responses",
      provider: "openai",
      protocol: OpenAIResponses.protocol,
      compact: OpenAIResponses.route.compact,
      endpoint: OpenAIResponses.route.endpoint,
      auth: request.model.route.auth,
      transport: OpenAIResponses.transport,
      headers: () => {
        calls.push("headers")
        return { "x-deployment": "resolved" }
      },
    }).with({ endpoint: { query: { deployment: "fixture" } } })
    const input = LLM.request({
      model: route.model({ id: "fixture" }),
      system: [SystemPart.make("system"), SystemPart.make("operator")],
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
    expect(result).toBeInstanceOf(CompactionCheckpointResponse)
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
    expect(calls).toEqual(["headers", "http"])
    const codec = Schema.fromJsonString(CompactionCheckpointResponse)
    expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(result))).toEqual(result)
    expect("replacement" in result).toBe(false)
  }),
)

for (const id of ["cmp_1", undefined]) {
  for (const added of [true, false]) {
    const item = { type: "compaction", id, encrypted_content: "opaque" }
    testEffect(
      fixedResponse(
        sseEvents(
          { type: "response.created", response: { id: "resp_1" } },
          ...(added ? [{ type: "response.output_item.added", output_index: 0, item: { type: "compaction", id } }] : []),
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: "resp_1", output: [item] } },
        ),
      ),
    ).effect(`correlates repeated checkpoint events: id=${id}, added=${added}`, () =>
      Effect.gen(function* () {
        const result = yield* LLMClient.compact(request, trigger)
        expect(result.checkpoint.encrypted).toBe("opaque")
        expect(result.checkpoint.id).toBeString()
      }),
    )
  }
}

testEffect(
  fixedResponse(
    sseEvents(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", id: "fc_1", name: "unexpected", arguments: "not JSON" },
      },
      { type: "response.output_text.delta", delta: "do not expose this" },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          output: [{ type: "function_call", id: "fc_1", name: "unexpected", arguments: "not JSON" }, checkpoint],
        },
      },
    ),
  ),
).effect("ignores other output rather than generating an answer or dispatching tools", () =>
  Effect.gen(function* () {
    const result = yield* LLMClient.compact(request, trigger)
    expect(result.checkpoint.encrypted).toBe("opaque")
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
  empty: [
    { type: "response.completed", response: { id: "resp_1", output: [{ ...checkpoint, encrypted_content: "" }] } },
  ],
  wrongType: [
    { type: "response.completed", response: { id: "resp_1", output: [{ ...checkpoint, encrypted_content: 42 }] } },
  ],
  noResponseID: [{ type: "response.completed", response: { output: [checkpoint] } }],
  changedID: [
    { type: "response.created", response: { id: "resp_1" } },
    { type: "response.completed", response: { id: "resp_2", output: [checkpoint] } },
  ],
  changedCheckpoint: [
    { type: "response.output_item.done", item: checkpoint },
    {
      type: "response.completed",
      response: { id: "resp_1", output: [{ ...checkpoint, encrypted_content: "changed" }] },
    },
  ],
  incomplete: [
    { type: "response.output_item.done", item: checkpoint },
    { type: "response.incomplete", response: { id: "resp_1", incomplete_details: { reason: "max_output_tokens" } } },
  ],
  failed: [
    { type: "response.output_item.done", item: checkpoint },
    { type: "response.failed", response: { id: "resp_1", error: { code: "server_error", message: "failed" } } },
  ],
  wrongStatus: [{ type: "response.completed", response: { id: "resp_1", status: "incomplete", output: [checkpoint] } }],
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
testEffect(truncatedStream([sseEvents({ type: "response.output_item.done", item: checkpoint })])).effect(
  "does not return a checkpoint from an interrupted stream",
  () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.compact(request, trigger).pipe(Effect.flip)
      expect(error.reason._tag).toBe("Transport")
    }),
)

for (const body of [{ input: [] }, { previous_response_id: "stale" }, { conversation: "stored" }]) {
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

test("trigger capability follows selected routes, independently of endpoint support", () => {
  expect(LLMClient.canCompact(request, trigger)).toBe(true)
  for (const model of [
    Azure.configure({ resourceName: "fixture" }).responses("fixture"),
    XAI.configure().responses("fixture"),
  ]) {
    expect(LLMClient.canCompact(LLM.request({ model }))).toBe(true)
    expect(LLMClient.canCompact(LLM.request({ model }), trigger)).toBe(false)
    expect(LLMClient.canCompact(LLMRequest.update(request, { model }), trigger)).toBe(false)
    expect(
      LLMClient.canCompact(
        LLM.request({ model: LanguageModel.update(request.model, { route: model.route }) }),
        trigger,
      ),
    ).toBe(false)
  }
})

testEffect(dynamicResponse(() => Effect.die("Must reject before sending"))).effect(
  "untyped unsupported mechanisms and routes fail locally in both client surfaces",
  () =>
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      for (const model of [
        Anthropic.configure().model("fixture"),
        Azure.configure({ resourceName: "fixture" }).responses("fixture"),
      ]) {
        const unsupported = LLM.request({ model })
        // @ts-expect-error Exercise untyped consumers; runtime must still reject unsupported routes.
        const error = yield* LLMClient.compact(unsupported, trigger).pipe(Effect.flip)
        expect(error.reason._tag).toBe("UnsupportedOperation")
        // @ts-expect-error The service has the same runtime guard.
        const serviceError = yield* client.compact(unsupported, trigger).pipe(Effect.flip)
        expect(serviceError.reason._tag).toBe("UnsupportedOperation")
      }
      // @ts-expect-error Exercise an unknown mechanism supplied by JavaScript.
      const error = yield* LLMClient.compact(request, { mechanism: "other" }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      // @ts-expect-error An empty string is not the default mechanism.
      const empty = yield* client.compact(request, { mechanism: "" }).pipe(Effect.flip)
      expect(empty.reason._tag).toBe("InvalidRequest")
    }),
)

for (const valid of [true, false]) {
  testEffect(fixedResponse("must not use HTTP")).effect(
    `acknowledges channel completion only after validation: valid=${valid}`,
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
                    response: { id: "resp_1", output: valid ? [checkpoint] : [] },
                  }),
                ),
                complete: Effect.sync(() => {
                  completed++
                }),
              }),
          },
        })
        const result = yield* Effect.result(operation)
        expect(result._tag).toBe(valid ? "Success" : "Failure")
        expect(completed).toBe(valid ? 1 : 0)
      }),
  )
}

test("checkpoint result schema rejects failed or unencrypted representations", () => {
  const decode = Schema.decodeUnknownSync(CompactionCheckpointResponse)
  for (const checkpoint of [
    { type: "compaction", provider: "anthropic", text: null },
    { type: "compaction", provider: "anthropic", text: "summary" },
    { type: "compaction", provider: "openai", encrypted: "" },
  ])
    expect(() => decode({ checkpoint, responseID: "resp_1" })).toThrow()
  expect(() =>
    decode({ checkpoint: { type: "compaction", provider: "openai", encrypted: "opaque" }, responseID: " " }),
  ).toThrow()
})

testEffect(
  scriptedResponses([
    sseEvents(
      { type: "response.created", response: { id: "resp_discarded" } },
      { type: "response.output_item.done", item: { ...checkpoint, encrypted_content: "discarded" } },
      { type: "response.incomplete", response: { id: "resp_discarded", usage: { input_tokens: 999 } } },
    ),
    sseEvents({
      type: "response.completed",
      response: { id: "resp_success", output: [checkpoint], usage: { input_tokens: 12 } },
    }),
  ]),
).effect("an explicitly retried effect does not reuse failed-attempt checkpoint or metadata", () =>
  Effect.gen(function* () {
    const operation = LLMClient.compact(request, trigger)
    yield* operation.pipe(Effect.flip)
    const result = yield* operation
    expect(result.checkpoint.encrypted).toBe("opaque")
    expect(result.responseID).toBe("resp_success")
    expect(result.usage?.inputTokens).toBe(12)
  }),
)
