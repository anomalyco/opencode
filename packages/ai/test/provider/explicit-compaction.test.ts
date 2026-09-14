import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, LLMRequest, Message, ToolDefinition } from "../../src/index.js"
import { LLMClient, Route } from "../../src/route/client.js"
import { Auth } from "../../src/route/auth.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { OpenAI, Azure, XAI, Anthropic, OpenAICompatibleResponses } from "../../src/providers/index.js"
import { testEffect } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
const retained = {
  type: "message",
  role: "user",
  id: "msg_1",
  status: "completed",
  content: [{ type: "input_text", text: "retained" }],
}
const output = [retained, checkpoint]

testEffect(
  dynamicResponse(({ request, text, respond }) =>
    Effect.sync(() => {
      expect(request.headers["x-deployment"]).toBe("fixture")
      expect(request.headers["x-override"]).toBe("request")
      expect(request.headers["x-default"]).toBe("configured")
      expect(request.headers.authorization).toBe("Bearer test")
      expect(new URL(request.url).searchParams.get("api-version")).toBe("fixture")
      expect(new URL(request.url).searchParams.get("trace")).toBe("request")
      if (new URL(request.url).pathname.endsWith("/compact")) {
        expect(JSON.parse(text)).toEqual({
          model: "overlaid",
          input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
          instructions: "request instructions",
          previous_response_id: "resp_previous",
        })
        return respond(JSON.stringify({ object: "response.compaction", output }))
      }
      return respond(sseEvents({ type: "response.completed", response: { id: "resp_1" } }))
    }),
  ),
).effect("generation and compaction share deployment headers, defaults, auth, query, and middleware", () =>
  Effect.gen(function* () {
    const headers: string[] = []
    const middleware: string[] = []
    const route = Route.make({
      id: "compaction-headers",
      provider: "openai",
      protocol: OpenAIResponses.protocol,
      compact: OpenAIResponses.route.compact,
      transport: OpenAIResponses.httpTransport,
      endpoint: Endpoint.path(({ body }) => `/${body.model}/responses`, {
        baseURL: "https://example.com",
        query: { "api-version": "fixture" },
      }),
      auth: Auth.bearer("test"),
      headers: ({ request }) => {
        expect(request.providerOptions?.store).toBe(false)
        headers.push(String(request.model.id))
        return { "x-deployment": "fixture", "x-override": "route" }
      },
      defaults: {
        headers: { "x-default": "configured", "x-override": "configured" },
        providerOptions: { store: false },
        http: { body: { instructions: "default instructions" } },
      },
    })
    const request = LLM.request({
      model: route.model({ id: "fixture" }),
      prompt: "hello",
      system: "system instructions",
      http: {
        headers: { "x-override": "request" },
        query: { trace: "request" },
        body: {
          model: "overlaid",
          instructions: "request instructions",
          previous_response_id: "resp_previous",
          store: false,
          stream: true,
        },
      },
    })
    const options: Parameters<typeof LLMClient.compact>[1] = {
      http: (request, next) => {
        middleware.push(new URL(request.url).pathname)
        return next(request)
      },
    }
    yield* LLMClient.generate(request, options)
    yield* LLMClient.compact(request, options)
    expect(headers).toEqual(["fixture", "fixture"])
    expect(middleware).toEqual(["/fixture/responses", "/fixture/responses/compact"])
  }),
)

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("fixture"),
  Azure.configure({ apiKey: "test", resourceName: "test" }).responses("fixture"),
  XAI.configure({ apiKey: "test" }).responses("fixture"),
]) {
  const item = {
    type: model.provider === "xai" ? "x_search_call" : "computer_call",
    id: "hosted_1",
    status: "completed",
  }
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toEndWith("/responses/compact")
        expect(JSON.parse(text)).toEqual({ model: "fixture", input: [item], instructions: "Keep the context" })
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect(`${model.provider} compacts provider-specific history without lowering generation settings`, () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model,
        system: "Keep the context",
        messages: [
          Message.assistant({
            type: "tool-result",
            id: item.id,
            name: item.type,
            result: { type: "json", value: item },
            providerExecuted: true,
            providerMetadata: { [model.route.providerMetadataKey ?? model.provider]: { itemId: item.id } },
          }),
        ],
      })
      for (const [candidate, tag] of [
        [
          LLMRequest.update(request, {
            tools: [
              ToolDefinition.make({
                name: "unsupported",
                description: "Generation only",
                inputSchema: {},
                native: { unsupported: {} },
              }),
            ],
          }),
          "InvalidRequest",
        ],
        [
          LLMRequest.update(request, { providerOptions: { contextManagement: "invalid-generation-option" } }),
          model.provider === "xai" ? "UnsupportedOperation" : "InvalidRequest",
        ],
      ] as const) {
        const error = yield* LLMClient.generate(candidate).pipe(Effect.flip)
        expect(error.reason._tag).toBe(tag)
        const response = yield* LLMClient.compact(candidate)
        expect(response.replacement[0]?.content[0]?.type).toBe("compaction")
      }
    }),
  )
}

const retainedItems = [
  retained,
  {
    type: "message",
    id: "msg_assistant",
    role: "assistant",
    status: "completed",
    phase: "commentary",
    content: [
      { type: "output_text", text: "First" },
      { type: "output_text", text: "Second" },
    ],
  },
  {
    type: "reasoning",
    id: "rs_1",
    summary: [
      { type: "summary_text", text: "Thinking" },
      { type: "summary_text", text: "More thinking" },
    ],
    encrypted_content: "reasoning-state",
  },
  { type: "reasoning", id: "rs_2", summary: [], encrypted_content: "hidden-reasoning" },
  {
    type: "message",
    id: "msg_media",
    role: "user",
    content: [
      { type: "input_image", image_url: "https://example.com/image.png" },
      { type: "input_file", filename: "report.pdf", file_data: "data:application/pdf;base64,cGRm", detail: "high" },
      { type: "input_file", filename: "other.pdf", file_url: "https://example.com/report.pdf", detail: "low" },
    ],
  },
  checkpoint,
]

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"),
  ...[undefined, "custom"].map((providerMetadataKey) =>
    Route.make({
      id: providerMetadataKey ?? "default-metadata",
      provider: "openai",
      providerMetadataKey,
      protocol: OpenAIResponses.protocol,
      compact: OpenAIResponses.route.compact,
      endpoint: OpenAIResponses.route.endpoint,
      transport: OpenAIResponses.httpTransport,
    }).model({ id: "fixture" }),
  ),
]) {
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        if (new URL(request.url).pathname.endsWith("/compact"))
          return respond(JSON.stringify({ object: "response.compaction", output: retainedItems }))
        expect(JSON.parse(text).input).toEqual(retainedItems)
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1" } }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    ),
  ).effect(`${model.route.id} retains messages, reasoning, and media through typed conversation parts`, () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model,
        prompt: "hello",
      })
      const compacted = yield* LLMClient.compact(request)
      expect(compacted.replacement.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
        "assistant",
        "user",
        "assistant",
      ])
      expect(compacted.replacement[1]?.content).toEqual([
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ])
      expect(compacted.replacement[2]?.content.map((part) => part.type)).toEqual(["reasoning", "reasoning"])
      expect(compacted.replacement[4]?.content.map((part) => part.type)).toEqual(["media", "media", "media"])
      const codec = Schema.fromJsonString(Schema.Array(Message))
      const messages = Schema.decodeSync(codec)(Schema.encodeSync(codec)(compacted.replacement))
      yield* LLMClient.generate(LLMRequest.update(request, { messages }))
    }),
  )
}

for (const overlay of [undefined, { service_tier: "priority", prompt_cache_key: "overridden" }]) {
  testEffect(
    dynamicResponse(({ text, respond }) =>
      Effect.sync(() => {
        expect(JSON.parse(text)).toEqual({
          model: "fixture",
          input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
          service_tier: overlay?.service_tier ?? "flex",
          prompt_cache_key: overlay?.prompt_cache_key ?? "affinity",
          prompt_cache_retention: "24h",
          prompt_cache_options: { mode: "explicit", ttl: "30m" },
        })
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect(`compact preserves supported request controls${overlay ? " with HTTP overrides" : ""}`, () =>
    LLMClient.compact(
      LLM.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
        prompt: "hello",
        promptCacheKey: "affinity",
        providerOptions: { serviceTier: "flex" },
        generation: { maxTokens: 100 },
        http: {
          body: {
            stream: true,
            store: false,
            prompt_cache_retention: "24h",
            prompt_cache_options: { mode: "explicit", ttl: "30m" },
            ...overlay,
          },
        },
      }),
    ),
  )
}

for (const item of [
  { type: "unknown_provider_item", data: "do not hide in a compaction part" },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_image", image_url: "https://example.com/image.png", detail: 42 }],
  },
  { type: "message", role: "user", content: [] },
  {
    type: "message",
    role: "assistant",
    content: [{ type: "input_image", image_url: "https://example.com/image.png" }],
  },
  { type: "message", role: "user", content: [{ type: "input_file", filename: "missing.pdf" }] },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_file", filename: "bad.pdf", file_url: "https://example.com/report.pdf", detail: 42 }],
  },
  {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_file",
        filename: "both.pdf",
        file_url: "https://example.com/report.pdf",
        file_data: "data:application/pdf;base64,cGRm",
      },
    ],
  },
]) {
  testEffect(fixedResponse(JSON.stringify({ object: "response.compaction", output: [item, checkpoint] }))).effect(
    `rejects unsupported compact output: ${JSON.stringify(item)}`,
    () =>
      Effect.gen(function* () {
        const error = yield* LLMClient.compact(
          LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
        ).pipe(Effect.flip)
        expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(error.reason.body).toContain(JSON.stringify(item))
        expect(error.reason.http?.status).toBe(200)
      }),
  )
}

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("fixture"),
  Azure.configure({ apiKey: "test", resourceName: "test" }).responses("fixture"),
  XAI.configure({ apiKey: "test" }).responses("fixture"),
]) {
  const images = [undefined, "low", "high", "auto"].map((detail) => ({
    type: "input_image",
    image_url: "https://example.com/image.png",
    ...(detail === undefined ? {} : { detail }),
  }))
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        if (new URL(request.url).pathname.endsWith("/compact"))
          return respond(
            JSON.stringify({
              object: "response.compaction",
              output: [{ type: "message", role: "user", content: images }, checkpoint],
            }),
          )
        expect(JSON.parse(text).input[0].content).toEqual(images)
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1" } }))
      }),
    ),
  ).effect(`${model.provider} preserves retained image detail through serialization and replay`, () =>
    Effect.gen(function* () {
      const request = LLM.request({ model, prompt: "hello" })
      const compacted = yield* LLMClient.compact(request)
      const codec = Schema.fromJsonString(Schema.Array(Message))
      const messages = Schema.decodeSync(codec)(Schema.encodeSync(codec)(compacted.replacement))
      yield* LLMClient.generate(LLMRequest.update(request, { messages }))
    }),
  )
}

testEffect(fixedResponse("must not execute")).effect("xAI rejects automatic compaction options", () =>
  Effect.gen(function* () {
    const request = LLMRequest.update(
      LLM.request({ model: XAI.configure({ apiKey: "test" }).responses("grok-4.6"), prompt: "hello" }),
      { providerOptions: { contextManagement: [{ type: "compaction" }] } },
    )
    const error = yield* LLMClient.generate(request).pipe(Effect.flip)
    expect(error.reason._tag).toBe("UnsupportedOperation")
    expect(error.message).toContain("LLMClient.compact")
    if (error.reason._tag === "UnsupportedOperation") expect(error.reason.operation).toBe("in-band-compaction")
  }),
)

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"),
  Azure.configure({ apiKey: "test", resourceName: "test" }).responses("deployment"),
  XAI.configure({ apiKey: "test" }).responses("grok-4.6"),
]) {
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        const body = JSON.parse(text)
        expect(request.method).toBe("POST")
        expect(request.headers[model.provider === "azure" ? "api-key" : "authorization"]).toBe(
          model.provider === "azure" ? "test" : "Bearer test",
        )
        if (new URL(request.url).pathname.endsWith("/responses/compact")) {
          expect(body).toEqual({
            model: model.id,
            input: [{ role: "user", content: [{ type: "input_text", text: "original" }] }],
            instructions: "system",
          })
          return respond(
            JSON.stringify({
              object: "response.compaction",
              output,
              usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010 },
            }),
            { headers: { "content-type": "application/json" } },
          )
        }
        expect(new URL(request.url).pathname.endsWith("/responses")).toBe(true)
        expect(body.input).toEqual([...output, { role: "user", content: [{ type: "input_text", text: "continue" }] }])
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1", output: [] } }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    ),
  ).effect(`${model.provider} explicitly compacts and replays the entire canonical window`, () =>
    Effect.gen(function* () {
      const request = LLM.request({ model, prompt: "original", system: "system", http: { body: { store: false } } })
      const compacted = yield* LLMClient.compact(request)
      expect(compacted.usage?.totalTokens).toBe(1010)
      expect(compacted.replacement.map((message) => message.role)).toEqual(["user", "assistant"])
      expect(compacted.replacement[0]?.content).toEqual([{ type: "text", text: "retained" }])
      expect(compacted.replacement[1]?.content).toEqual([
        { type: "compaction", provider: model.provider, id: "cmp_1", encrypted: "opaque" },
      ])
      const codec = Schema.fromJsonString(Schema.Array(Message))
      const messages = Schema.decodeSync(codec)(Schema.encodeSync(codec)(compacted.replacement))
      yield* LLMClient.generate(LLMRequest.update(request, { messages: [...messages, Message.user("continue")] }))
    }),
  )
}

for (const model of [
  Anthropic.configure({ apiKey: "test" }).model("claude-opus-4-6"),
  OpenAICompatibleResponses.configure({ apiKey: "test", baseURL: "https://compatible.example/v1" }).model("model"),
]) {
  testEffect(fixedResponse("must not execute")).effect(
    `${model.route.id} does not inherit an unsupported compact endpoint`,
    () =>
      Effect.gen(function* () {
        // @ts-expect-error Untyped callers must still receive the runtime capability error.
        const error = yield* LLMClient.compact(LLM.request({ model, prompt: "hello" })).pipe(Effect.flip)
        expect(error.reason._tag).toBe("UnsupportedOperation")
        expect(error.message).toContain("does not support explicit compaction")
        if (error.reason._tag === "UnsupportedOperation") expect(error.reason.operation).toBe("compact")
      }),
  )
}

testEffect(
  fixedResponse(JSON.stringify({ object: "response.compaction", output: [retained], debug: "original payload" })),
).effect("invalid explicit compaction preserves the original response and HTTP context", () =>
  Effect.gen(function* () {
    const error = yield* LLMClient.compact(
      LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
    expect(error.reason.body).toContain("original payload")
    expect(error.reason.http?.status).toBe(200)
  }),
)
