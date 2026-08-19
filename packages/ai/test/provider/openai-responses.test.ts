import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Ref, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import {
  LLM,
  AIError,
  HttpOptions,
  LLMEvent,
  LLMRequest,
  Message,
  LanguageModel,
  ToolCallPart,
  ToolDefinition,
  ToolResultPart,
  TransportReason,
  Usage,
} from "../../src/index.js"
import {
  Auth,
  LLMClient,
  RequestExecutor,
  WebSocketTransport,
  type ChannelObservation,
  type WebSocketChannelDriver,
} from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import * as Azure from "../../src/providers/azure.js"
import * as OpenAI from "../../src/providers/openai.js"
import * as XAI from "../../src/providers/xai.js"
import * as OpenAIResponses from "../../src/protocols/openai-responses.js"
import { OpenAIResponsesChannel } from "../../src/protocols/openai-responses-channel.js"
import * as ProviderShared from "../../src/protocols/shared.js"
import { continuationRequest, nativeOpenAIResponsesContinuation } from "../continuation-scenarios.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = OpenAIResponses.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4.1-mini" })

const xaiModel = XAI.configure({ apiKey: "test", baseURL: "https://api.x.ai/v1" }).responses("grok-4.5")

const baseChannelDriver = (message: string): WebSocketChannelDriver => ({
  create: () => Effect.succeed({ message, mode: "full" }),
  observe: (_create, frame): Effect.Effect<ChannelObservation, AIError> => {
    const event = ProviderShared.decodeJson(frame)
    if (!ProviderShared.isRecord(event)) return Effect.die("Expected event")
    if (event.type === "response.completed") return Effect.succeed({ type: "completed", frame })
    if (event.type === "response.incomplete") return Effect.succeed({ type: "incomplete", frame })
    if (event.type === "error" || event.type === "response.failed")
      return Effect.succeed({
        type: "provider-failure",
        error: new AIError({
          module: "test",
          method: "stream",
          reason: new TransportReason({
            message: "provider rejected request",
            transport: "websocket",
            operation: "read",
            phase: "receive",
          }),
        }),
      })
    return Effect.succeed({ type: "frame", frame })
  },
})

const continuationDriver = (request: Readonly<Record<string, unknown>>) => {
  const message = ProviderShared.encodeJson(request)
  return OpenAIResponsesChannel.driver({
    id: "openai-responses",
    name: "OpenAI Responses",
    request,
    message,
    base: baseChannelDriver(message),
  })
}

const checkpoint = (observation: ChannelObservation) => {
  if (observation.type !== "completed" || !observation.checkpoint) throw new Error("Expected checkpoint")
  return observation.checkpoint
}

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const configEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

type OpenAIToolOutput = Extract<
  OpenAIResponses.OpenAIResponsesBody["input"][number],
  { readonly type: "function_call_output" }
>

const expectToolOutput = (body: OpenAIResponses.OpenAIResponsesBody): OpenAIToolOutput => {
  const output = body.input.find(
    (item): item is OpenAIToolOutput => "type" in item && item.type === "function_call_output",
  )
  expect(output).toBeDefined()
  return output!
}

describe("OpenAI Responses route", () => {
  it.effect("prepares OpenAI Responses target", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(request)

      expect(prepared.body).toEqual({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: "You are concise." },
          { role: "user", content: [{ type: "input_text", text: "Say hello." }] },
        ],
        store: false,
        stream: true,
        max_output_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("lowers the hosted OpenAI image generation tool", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Show me a rooftop garden.",
          tools: [OpenAI.imageGeneration({ action: "generate", quality: "high", size: "1024x1024" })],
          toolChoice: "image_generation",
        }),
      )

      expect(prepared.body.tools).toEqual([
        { type: "image_generation", action: "generate", quality: "high", size: "1024x1024" },
      ])
      expect(prepared.body.tool_choice).toEqual({ type: "image_generation" })
    }),
  )

  it.effect("rejects invalid hosted image generation options locally", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Show me a rooftop garden.",
          tools: [OpenAI.imageGeneration({ outputCompression: -1, partialImages: 4, size: "bogus" })],
        }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("image generation tool options are invalid")
    }),
  )

  it.effect("lowers semantic service tier options", () =>
    Effect.gen(function* () {
      const input = LLMRequest.update(request, { providerOptions: { openai: { serviceTier: "priority" } } })
      expect(input.providerOptions).toEqual({ openai: { serviceTier: "priority" } })
      const prepared = yield* compileRequest(input)

      expect(prepared.body).toMatchObject({ service_tier: "priority" })
      expect(prepared.body).not.toHaveProperty("serviceTier")
    }),
  )

  it.effect("passes through custom OpenAI reasoning effort strings", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, { providerOptions: { openai: { reasoningEffort: "experimental" } } }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "experimental" })
    }),
  )

  it.effect("omits unsupported semantic service tiers", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, { providerOptions: { openai: { serviceTier: "unsupported" } } }),
      )

      expect(prepared.body).not.toHaveProperty("service_tier")
    }),
  )

  it.effect("flattens top-level object unions in function schemas", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          tools: [
            ToolDefinition.make({
              name: "read",
              description: "Read a path or resource.",
              inputSchema: {
                type: "object",
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      reference: { anyOf: [{ type: "string" }, { type: "null" }] },
                      limit: { type: "integer", maximum: 2000 },
                    },
                    required: ["path"],
                  },
                  {
                    type: "object",
                    properties: { resource: { type: "string" }, limit: { type: "integer", maximum: 51200 } },
                    required: ["resource"],
                  },
                ],
              },
            }),
          ],
        }),
      )

      expect(prepared.body.tools).toEqual([
        {
          type: "function",
          name: "read",
          description: "Read a path or resource.",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              reference: { type: "string" },
              limit: { type: "integer", maximum: 2000 },
              resource: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      ])
    }),
  )

  it.effect("lowers chronological system updates to developer messages in order", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [Message.user("Before."), Message.system("Operator update."), Message.assistant("After.")],
        }),
      )

      expect(prepared.body.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "Before." }] },
        { role: "developer", content: "Operator update." },
        { role: "assistant", content: [{ type: "output_text", text: "After." }] },
      ])
    }),
  )

  it.effect("prepares one OpenAI Responses route for either transport", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          model: OpenAIResponses.route
            .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
            .model({ id: "gpt-4.1-mini" }),
        }),
      )

      expect(prepared.route).toBe("openai-responses")
      expect(prepared.protocol).toBe("openai-responses")
      expect(prepared.metadata).toEqual({ transport: "http-json" })
      expect(prepared.body).toMatchObject({ model: "gpt-4.1-mini", store: false, stream: true })
    }),
  )

  it.effect("streams OpenAI Responses over WebSocket", () =>
    Effect.gen(function* () {
      const sent: string[] = []
      const opened: Array<{
        readonly url: string
        readonly authorization: string | undefined
        readonly protocol: string | undefined
      }> = []
      let closed = false
      const deps = Layer.succeed(
        RequestExecutor.Service,
        RequestExecutor.Service.of({
          execute: () => Effect.die("unexpected HTTP request"),
        }),
      )
      const webSocket = WebSocketTransport.makeDirect({
        open: (input) =>
          Effect.succeed({
            sendText: (message) =>
              Effect.sync(() => {
                opened.push({
                  url: input.url,
                  authorization: input.headers.authorization,
                  protocol: input.headers["openai-beta"],
                })
                sent.push(message)
              }),
            messages: Stream.fromArray([
              ProviderShared.encodeJson({ type: "response.created", response: { id: "resp_ws" } }),
              ProviderShared.encodeJson({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" }),
              ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_ws" } }),
            ]),
            close: Effect.sync(() => {
              closed = true
            }),
          }),
      })
      const response = yield* LLMClient.generate(
        LLM.request({
          model: OpenAI.configure({
            baseURL: "https://api.openai.test/v1/",
            apiKey: "test",
            headers: { "openai-beta": "custom-protocol" },
          }).responses("gpt-4.1-mini"),
          prompt: "Say hello.",
        }),
        { webSocket },
      ).pipe(Effect.provide(LLMClient.layer.pipe(Layer.provide(deps))))

      expect(response.text).toBe("Hi")
      expect(opened).toEqual([
        {
          url: "wss://api.openai.test/v1/responses",
          authorization: "Bearer test",
          protocol: "custom-protocol",
        },
      ])
      expect(closed).toBe(true)
      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0])).toEqual({
        type: "response.create",
        model: "gpt-4.1-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: "Say hello." }] }],
        store: false,
      })
    }),
  )

  it.effect("rejects out-of-order and mismatched WebSocket response events", () =>
    Effect.gen(function* () {
      const streams = [
        Stream.fromArray([
          ProviderShared.encodeJson({ type: "response.output_text.delta", item_id: "late", delta: "Late" }),
          ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_old" } }),
        ]),
        Stream.fromArray([
          ProviderShared.encodeJson({ type: "response.created", response: { id: "resp_new" } }),
          ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_old" } }),
        ]),
      ]
      const webSocket = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: () => Effect.void,
            messages: streams.shift() ?? Stream.die("unexpected WebSocket open"),
            close: Effect.void,
          }),
      })
      const deps = Layer.succeed(
        RequestExecutor.Service,
        RequestExecutor.Service.of({ execute: () => Effect.die("unexpected HTTP request") }),
      )
      const model = OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses(
        "gpt-4.1-mini",
      )

      const errors = yield* Effect.forEach(["late", "mismatch"], (prompt) =>
        LLMClient.generate(LLM.request({ model, prompt }), { webSocket }).pipe(
          Effect.provide(LLMClient.layer.pipe(Layer.provide(deps))),
          Effect.flip,
        ),
      )

      expect(errors.map((error) => error.reason._tag)).toEqual(["InvalidProviderOutput", "InvalidProviderOutput"])
      expect(errors[0]?.message).toContain("before response.created")
      expect(errors[1]?.message).toContain("response ID changed")
    }),
  )

  it.effect("continues a tool call with only the new tool output", () =>
    Effect.gen(function* () {
      const firstRequest = {
        type: "response.create",
        model: "gpt-5.2",
        store: false,
        input: [{ role: "user", content: [{ type: "input_text", text: "Weather?" }] }],
      }
      const first = continuationDriver(firstRequest)
      const firstCreate = yield* first.create(undefined)
      yield* first.observe(
        firstCreate,
        ProviderShared.encodeJson({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "fc_1",
            status: "completed",
            call_id: "call_1",
            name: "weather",
            arguments: '{ "city": "Paris" }',
          },
        }),
      )
      const saved = checkpoint(
        yield* first.observe(
          firstCreate,
          ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_1" } }),
        ),
      )
      const second = continuationDriver({
        ...firstRequest,
        input: [
          ...firstRequest.input,
          { type: "function_call", call_id: "call_1", name: "weather", arguments: '{"city":"Paris"}' },
          { type: "function_call_output", call_id: "call_1", output: '{"temperature":22}' },
        ],
      })

      const create = yield* second.create(saved)

      expect(create.mode).toBe("incremental")
      expect(ProviderShared.decodeJson(create.message)).toMatchObject({
        previous_response_id: "resp_1",
        input: [{ type: "function_call_output", call_id: "call_1", output: '{"temperature":22}' }],
      })
    }),
  )

  it.effect("continues a promoted steer after the completed assistant output", () =>
    Effect.gen(function* () {
      const firstInput = [{ role: "user", content: [{ type: "input_text", text: "First" }] }]
      const first = continuationDriver({ type: "response.create", model: "gpt-5.2", store: false, input: firstInput })
      const create = yield* first.create(undefined)
      yield* first.observe(
        create,
        ProviderShared.encodeJson({
          type: "response.output_item.done",
          item: {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "Hello" }],
          },
        }),
      )
      const saved = checkpoint(
        yield* first.observe(
          create,
          ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_1" } }),
        ),
      )
      const steer = { role: "user", content: [{ type: "input_text", text: "Actually, be brief" }] }
      const next = continuationDriver({
        type: "response.create",
        model: "gpt-5.2",
        store: false,
        input: [...firstInput, { role: "assistant", content: [{ type: "output_text", text: "Hello" }] }, steer],
      })

      const continued = yield* next.create(saved)

      expect(continued.mode).toBe("incremental")
      expect(ProviderShared.decodeJson(continued.message)).toMatchObject({
        previous_response_id: "resp_1",
        input: [steer],
      })
    }),
  )

  it.effect("continues store-false reasoning without replaying the output-only item ID", () =>
    Effect.gen(function* () {
      const firstInput = [{ role: "user", content: [{ type: "input_text", text: "Think" }] }]
      const request = { type: "response.create", model: "gpt-5.2", store: false, input: firstInput }
      const first = continuationDriver(request)
      const create = yield* first.create(undefined)
      yield* first.observe(
        create,
        ProviderShared.encodeJson({
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            summary: [{ type: "summary_text", text: "Thought" }],
            content: [{ type: "reasoning_text", text: "Raw thought" }],
            encrypted_content: "encrypted",
            status: "completed",
          },
        }),
      )
      const saved = checkpoint(
        yield* first.observe(
          create,
          ProviderShared.encodeJson({
            type: "response.completed",
            response: {
              id: "resp_1",
              output: [
                {
                  type: "reasoning",
                  id: "rs_1",
                  summary: [{ type: "summary_text", text: "Thought" }],
                  content: [{ type: "reasoning_text", text: "Raw thought" }],
                  encrypted_content: "encrypted",
                  status: "completed",
                },
              ],
            },
          }),
        ),
      )
      const next = continuationDriver({
        ...request,
        input: [
          ...firstInput,
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Thought" }],
            content: [{ type: "reasoning_text", text: "Raw thought" }],
            encrypted_content: "encrypted",
            status: "completed",
          },
          { role: "user", content: [{ type: "input_text", text: "Continue" }] },
        ],
      })

      const continued = yield* next.create(saved)

      expect(continued.mode).toBe("incremental")
      expect(ProviderShared.decodeJson(continued.message)).toMatchObject({
        previous_response_id: "resp_1",
        input: [{ role: "user", content: [{ type: "input_text", text: "Continue" }] }],
      })
    }),
  )

  it.effect("uses a full request when any non-input invariant changes", () =>
    Effect.gen(function* () {
      const request = {
        type: "response.create",
        model: "gpt-5.2",
        store: false,
        metadata: { source: "one" },
        input: [{ role: "user", content: [{ type: "input_text", text: "First" }] }],
      }
      const first = continuationDriver(request)
      const create = yield* first.create(undefined)
      const saved = checkpoint(
        yield* first.observe(
          create,
          ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_1" } }),
        ),
      )
      const appended = [...request.input, { role: "user", content: [{ type: "input_text", text: "Second" }] }]
      const changes = [
        { ...request, model: "gpt-5.3", input: appended },
        { ...request, instructions: "Changed", input: appended },
        { ...request, tools: [{ type: "function", name: "other" }], input: appended },
        { ...request, temperature: 0.5, input: appended },
        { ...request, metadata: { source: "two" }, input: appended },
        {
          ...request,
          input: [{ role: "user", content: [{ type: "input_text", text: "Rewritten history" }] }, appended[1]],
        },
      ]

      const creates = yield* Effect.forEach(changes, (changed) => continuationDriver(changed).create(saved))

      expect(creates.map((item) => item.mode)).toEqual(changes.map(() => "full"))
      expect(
        creates
          .map((item) => ProviderShared.decodeJson(item.message))
          .every((item) => ProviderShared.isRecord(item) && !("previous_response_id" in item)),
      ).toBe(true)
    }),
  )

  it.effect("stages no checkpoint for incomplete or ID-less completion", () =>
    Effect.gen(function* () {
      const driver = continuationDriver({ type: "response.create", model: "gpt-5.2", input: [] })
      const create = yield* driver.create(undefined)

      const completed = yield* driver.observe(
        create,
        ProviderShared.encodeJson({ type: "response.completed", response: {} }),
      )
      expect(completed).toMatchObject({ type: "completed" })
      expect(completed).not.toHaveProperty("checkpoint")
      expect(
        yield* driver.observe(create, ProviderShared.encodeJson({ type: "response.incomplete", response: {} })),
      ).toMatchObject({ type: "incomplete" })
    }),
  )

  it.effect("classifies explicit continuation rejection for runner-owned recovery", () =>
    Effect.gen(function* () {
      const driver = continuationDriver({ type: "response.create", model: "gpt-5.2", input: [] })
      const create = yield* driver.create(undefined)
      const missing = yield* driver.observe(
        create,
        ProviderShared.encodeJson({
          type: "error",
          error: { code: "previous_response_not_found", message: "Missing response" },
        }),
      )
      const limit = yield* driver.observe(
        create,
        ProviderShared.encodeJson({
          type: "error",
          error: { code: "websocket_connection_limit_reached", message: "Rotate" },
        }),
      )

      expect(missing).toMatchObject({
        type: "rejected",
        recovery: "retry-full",
        error: { reason: { _tag: "Transport", delivery: "rejected", recovery: "retry-full" } },
      })
      expect(limit).toMatchObject({
        type: "rejected",
        recovery: "rotate-and-retry-full",
        error: {
          reason: { _tag: "Transport", delivery: "rejected", recovery: "rotate-and-retry-full" },
        },
      })
    }),
  )

  it.effect("builds WebSocket and HTTP fallback from the same final request", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const message = yield* Ref.make("")
      const body = yield* Ref.make("")
      const response = yield* LLMClient.generate(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-4.1-mini"),
          prompt: "Say hello.",
          http: {
            body: {
              model: "overlaid-model",
              metadata: { source: "overlay" },
              stream_options: { include_usage: true },
              background: true,
            },
            headers: { "x-request": "request" },
            query: { mode: "test" },
          },
        }),
        {
          webSocket: {
            execute: (exchange) =>
              Effect.gen(function* () {
                expect(exchange.connect.rotateAfterMs).toBe(55 * 60 * 1000)
                expect(exchange.connect.headers["openai-beta"]).toBe("responses_websockets=2026-02-06")
                expect(exchange.connect.headers["content-length"]).toBeUndefined()
                yield* exchange.driver
                  .create(undefined)
                  .pipe(Effect.flatMap((create) => Ref.set(message, create.message)))
                return { frames: exchange.fallback(), complete: Effect.void }
              }),
          },
        },
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (value) => value + 1)
              yield* Ref.set(body, input.text)
              expect(input.request.url).toBe("https://api.openai.test/v1/responses?mode=test")
              expect(input.request.headers.authorization).toBe("Bearer test")
              expect(input.request.headers["x-request"]).toBe("request")
              return input.respond(sseEvents({ type: "response.completed", response: {} }), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )

      const httpBody = JSON.parse(yield* Ref.get(body))
      const { stream: _stream, stream_options: _streamOptions, background: _background, ...shared } = httpBody
      expect(response.finishReason?.normalized).toBe("stop")
      expect(yield* Ref.get(attempts)).toBe(1)
      expect(JSON.parse(yield* Ref.get(message))).toEqual({ type: "response.create", ...shared })
      expect(httpBody).toMatchObject({
        model: "overlaid-model",
        metadata: { source: "overlay" },
        stream: true,
        stream_options: { include_usage: true },
        background: true,
      })
    }),
  )

  it.effect("uses exactly one HTTP request when no WebSocket executor is supplied", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      yield* LLMClient.generate(
        LLMRequest.update(request, { http: new HttpOptions({ body: { input: "raw-http-input" } }) }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (value) => value + 1)
              expect(JSON.parse(input.text).input).toBe("raw-http-input")
              return input.respond(sseEvents({ type: "response.completed", response: {} }), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )

      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("closes a direct WebSocket execution after partial consumption", () =>
    Effect.gen(function* () {
      const closed = yield* Ref.make(false)
      const webSocket = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: () => Effect.void,
            messages: Stream.fromArray([
              ProviderShared.encodeJson({ type: "response.created", response: { id: "resp_ws" } }),
              ProviderShared.encodeJson({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" }),
              ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp_ws" } }),
            ]),
            close: Ref.set(closed, true),
          }),
      })

      yield* LLMClient.stream(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-4.1-mini"),
          prompt: "Say hello.",
        }),
        { webSocket },
      ).pipe(
        Stream.take(1),
        Stream.runDrain,
        Effect.provide(
          LLMClient.layer.pipe(
            Layer.provide(
              Layer.succeed(
                RequestExecutor.Service,
                RequestExecutor.Service.of({ execute: () => Effect.die("unexpected HTTP request") }),
              ),
            ),
          ),
        ),
      )

      expect(yield* Ref.get(closed)).toBe(true)
    }),
  )

  it.effect("terminates WebSocket control events without waiting for the socket to close", () =>
    Effect.gen(function* () {
      const events = [
        { type: "error", error: { code: "slow_down", message: "Try later" } },
        {
          type: "error",
          status_code: 429,
          message: "Rate limited",
          headers: { "retry-after": 1, "x-request-id": "request", cached: false, invalid: [] },
        },
        {
          type: "response.failed",
          response: { error: { code: "server_error", message: "Unavailable" } },
        },
        { type: "error", status: "not-a-status", message: "Malformed status" },
      ]

      const errors = yield* Effect.forEach(events, (event) =>
        LLMClient.generate(
          LLM.request({
            model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses(
              "gpt-4.1-mini",
            ),
            prompt: "Say hello.",
          }),
          {
            webSocket: WebSocketTransport.makeDirect({
              open: () =>
                Effect.succeed({
                  sendText: () => Effect.void,
                  messages: Stream.make(ProviderShared.encodeJson(event)).pipe(Stream.concat(Stream.never)),
                  close: Effect.void,
                }),
            }),
          },
        ).pipe(
          Effect.provide(
            LLMClient.layer.pipe(
              Layer.provide(
                Layer.succeed(
                  RequestExecutor.Service,
                  RequestExecutor.Service.of({ execute: () => Effect.die("unexpected HTTP request") }),
                ),
              ),
            ),
          ),
          Effect.flip,
        ),
      )

      expect(errors.map((error) => error.reason._tag)).toEqual([
        "ProviderInternal",
        "RateLimit",
        "ProviderInternal",
        "UnknownProvider",
      ])
    }),
  )

  it.effect("marks post-send WebSocket failures with delivery state", () =>
    Effect.gen(function* () {
      const failure = new AIError({
        module: "test",
        method: "receive",
        reason: new TransportReason({
          message: "socket closed",
          transport: "websocket",
          operation: "read",
          phase: "close",
        }),
      })
      const streams = [
        Stream.fail(failure),
        Stream.make(ProviderShared.encodeJson({ type: "response.created", response: { id: "resp_observed" } })).pipe(
          Stream.concat(Stream.fail(failure)),
        ),
      ]
      const deps = Layer.succeed(
        RequestExecutor.Service,
        RequestExecutor.Service.of({ execute: () => Effect.die("unexpected HTTP request") }),
      )
      const webSocket = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: () => Effect.void,
            messages: streams.shift() ?? Stream.die("unexpected WebSocket open"),
            close: Effect.void,
          }),
      })
      const model = OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses(
        "gpt-4.1-mini",
      )

      const errors = yield* Effect.forEach(["first", "second"], (prompt) =>
        LLMClient.generate(LLM.request({ model, prompt }), { webSocket }).pipe(
          Effect.provide(LLMClient.layer.pipe(Layer.provide(deps))),
          Effect.flip,
        ),
      )

      expect(errors.map((error) => error.reason)).toEqual([
        expect.objectContaining({ _tag: "Transport", phase: "close", delivery: "ambiguous" }),
        expect.objectContaining({ _tag: "Transport", phase: "close", delivery: "accepted" }),
      ])
    }),
  )

  it.effect("fails immediately when WebSocket is already closed", () =>
    Effect.gen(function* () {
      const error = yield* WebSocketTransport.fromWebSocket(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- fromWebSocket reads readyState before touching WebSocket methods on this branch.
        { readyState: globalThis.WebSocket.CLOSED } as globalThis.WebSocket,
        { url: "wss://api.openai.test/v1/responses", headers: Headers.empty },
      ).pipe(Effect.flip)

      expect(error.message).toContain("closed before opening")
      expect(error.reason).toMatchObject({ _tag: "Transport", phase: "connect", delivery: "not-sent" })
    }),
  )

  it.effect("adds native query params to the Responses URL", () =>
    Effect.gen(function* () {
      yield* LLMClient.generate(
        LLMRequest.update(request, {
          model: LanguageModel.update(model, {
            route: model.route.with({ endpoint: { query: { "api-version": "v1" } } }),
          }),
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.openai.test/v1/responses?api-version=v1")
              return input.respond(sseEvents({ type: "response.completed", response: {} }), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )
    }),
  )

  it.effect("uses Azure api-key header for static OpenAI Responses keys", () =>
    Effect.gen(function* () {
      yield* LLMClient.generate(
        LLMRequest.update(request, {
          model: Azure.configure({
            baseURL: "https://opencode-test.openai.azure.com/openai/",
            apiKey: "azure-key",
            headers: { authorization: "Bearer stale" },
          }).responses("gpt-4.1-mini"),
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://opencode-test.openai.azure.com/openai/v1/responses?api-version=v1")
              expect(web.headers.get("api-key")).toBe("azure-key")
              expect(web.headers.get("authorization")).toBeNull()
              return input.respond(sseEvents({ type: "response.completed", response: {} }), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )
    }),
  )

  it.effect("loads OpenAI default auth from Effect Config", () =>
    LLMClient.generate(
      LLMRequest.update(request, {
        model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/" }).responses("gpt-4.1-mini"),
      }),
    ).pipe(
      configEnv({ OPENAI_API_KEY: "env-key" }),
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.headers.get("authorization")).toBe("Bearer env-key")
            return input.respond(sseEvents({ type: "response.completed", response: {} }), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("lets explicit auth override OpenAI default API key auth", () =>
    LLMClient.generate(
      LLMRequest.update(request, {
        model: OpenAI.configure({
          baseURL: "https://api.openai.test/v1/",
          auth: Auth.bearer("oauth-token"),
        }).responses("gpt-4.1-mini"),
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.headers.get("authorization")).toBe("Bearer oauth-token")
            return input.respond(sseEvents({ type: "response.completed", response: {} }), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("prepares function call and function output input items", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result",
          model,
          messages: [
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.body).toEqual({
        model: "gpt-4.1-mini",
        input: [
          { role: "user", content: [{ type: "input_text", text: "What is the weather?" }] },
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"query":"weather"}' },
          { type: "function_call_output", call_id: "call_1", output: '{"forecast":"sunny"}' },
        ],
        store: false,
        stream: true,
        max_output_tokens: undefined,
        temperature: undefined,
        tool_choice: undefined,
        tools: undefined,
        top_p: undefined,
      })
    }),
  )

  it.effect("preserves structured tool errors for the model", () =>
    Effect.gen(function* () {
      const error = {
        error: { type: "unknown", message: "Tool execution interrupted" },
        content: [],
        structured: {},
      }
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "bash", input: { command: "sleep 10" } })]),
            Message.tool({
              id: "call_1",
              name: "bash",
              resultType: "error",
              result: error,
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toBe(ProviderShared.encodeJson(error))
    }),
  )

  it.effect("keeps primitive tool errors as plain text", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "bash", input: {} })]),
            Message.tool({ id: "call_1", name: "bash", resultType: "error", result: 503 }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toBe("503")
    }),
  )

  it.effect("keeps non-JSON tool errors as plain text", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "bash", input: {} })]),
            Message.tool({ id: "call_1", name: "bash", resultType: "error", result: new Error("boom") }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toBe("Error: boom")
    }),
  )

  // Regression: screenshot/read tool results must stay structured so base64
  // image data is not JSON-stringified into `function_call_output.output`.
  it.effect("lowers image tool-result content as structured input_image items", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_image",
          model,
          messages: [
            Message.user("Show me the screenshot."),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: { filePath: "shot.png" } })]),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri: "data:image/png;base64,AAECAw==", mime: "image/png" },
              ],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        { type: "input_text", text: "Image read successfully" },
        { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
      ])
    }),
  )

  it.effect("lowers single-image tool-result content as structured input_image array", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_image_only",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "screenshot", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "screenshot",
              resultType: "content",
              result: [{ type: "file", uri: "data:image/png;base64,AAECAw==", mime: "image/png" }],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
      ])
    }),
  )

  it.effect("lowers PDF tool-result content as structured input_file array", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_pdf",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [
                {
                  type: "file",
                  uri: "data:application/pdf;base64,JVBERi0xLjQ=",
                  mime: "application/pdf",
                  name: "report.pdf",
                },
              ],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        {
          type: "input_file",
          filename: "report.pdf",
          file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
        },
      ])
    }),
  )

  it.effect("passes large PDF tool-result content through", () =>
    Effect.gen(function* () {
      const base64 = "A".repeat(8_125_844)
      const dataUrl = `data:application/pdf;base64,${base64}`
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_large_pdf",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [{ type: "file", uri: dataUrl, mime: "application/pdf", name: "report.pdf" }],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        { type: "input_file", filename: "report.pdf", file_data: dataUrl },
      ])
    }),
  )

  it.effect("uses xAI inline file encoding for PDF tool results", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: xaiModel,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [
                {
                  type: "file",
                  uri: "data:application/pdf;base64,JVBERi0xLjQ=",
                  mime: "application/pdf",
                  name: "report.pdf",
                },
              ],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        {
          type: "input_file",
          filename: "report.pdf",
          file_data: "JVBERi0xLjQ=",
          mime_type: "application/pdf",
        },
      ])
    }),
  )

  it.effect("passes non-image tool-result content through as an input file", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_unsupported_media",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "fetch", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "fetch",
              resultType: "content",
              result: [{ type: "file", uri: "data:audio/mpeg;base64,AAECAw==", mime: "audio/mpeg" }],
            }),
          ],
        }),
      )

      expect(expectToolOutput(prepared.body).output).toEqual([
        { type: "input_file", filename: "file", file_data: "data:audio/mpeg;base64,AAECAw==" },
      ])
    }),
  )

  it.effect("prepares the composed native continuation request", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        continuationRequest({
          id: "req_native_continuation_openai",
          model,
          features: nativeOpenAIResponsesContinuation,
        }),
      )

      expect(prepared.body).toMatchObject({
        input: [
          { role: "system", content: "You are concise. Continue from the provided history." },
          {
            role: "user",
            content: [
              { type: "input_text", text: "What is shown here?" },
              { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
            ],
          },
          {
            type: "reasoning",
            encrypted_content: "encrypted-continuation-state",
            summary: [{ type: "summary_text", text: "I inspected the previous turn." }],
          },
          { role: "assistant", content: [{ type: "output_text", text: "It shows a small test image." }] },
          { role: "user", content: [{ type: "input_text", text: "Check the weather in Paris before continuing." }] },
          { type: "function_call", call_id: "call_weather_1", name: "get_weather", arguments: '{"city":"Paris"}' },
          { type: "function_call_output", call_id: "call_weather_1", output: '{"temperature":22}' },
          { role: "assistant", content: [{ type: "output_text", text: "Paris is 22 degrees." }] },
          {
            role: "user",
            content: [{ type: "input_text", text: "Continue from this conversation in one short sentence." }],
          },
        ],
        include: ["reasoning.encrypted_content"],
        store: false,
      })
      expect(prepared.body.tools).toEqual([expect.objectContaining({ type: "function", name: "get_weather" })])
    }),
  )

  it.effect("maps OpenAI provider options to Responses options", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).model("gpt-5.2"),
          prompt: "think",
          promptCacheKey: "session_123",
          tools: [
            ToolDefinition.make({ name: "read", description: "Read a file", inputSchema: { type: "object" } }),
            ToolDefinition.make({ name: "grep", description: "Search files", inputSchema: { type: "object" } }),
          ],
          toolChoice: "none",
          providerOptions: {
            openai: {
              reasoningEffort: "high",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
              truncation: "disabled",
              allowedTools: { toolNames: ["read", "grep"], mode: "required" },
              maxToolCalls: 4,
              parallelToolCalls: false,
            },
          },
        }),
      )

      expect(prepared.body.store).toBe(false)
      expect(prepared.body.prompt_cache_key).toBe("session_123")
      expect(prepared.body.include).toEqual(["reasoning.encrypted_content"])
      expect(prepared.body.reasoning).toEqual({ effort: "high", summary: "auto" })
      expect(prepared.body.text).toEqual({ verbosity: "low" })
      expect(prepared.body.truncation).toBe("disabled")
      expect(prepared.body.tool_choice).toEqual({
        type: "allowed_tools",
        mode: "required",
        tools: [
          { type: "function", name: "read" },
          { type: "function", name: "grep" },
        ],
      })
      expect(prepared.body.max_tool_calls).toBe(4)
      expect(prepared.body.parallel_tool_calls).toBe(false)
    }),
  )

  it.effect("accepts the full ResponseIncludable union", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "hi",
          providerOptions: {
            openai: {
              include: ["reasoning.encrypted_content", "code_interpreter_call.outputs", "web_search_call.results"],
            },
          },
        }),
      )

      expect(prepared.body.include).toEqual([
        "reasoning.encrypted_content",
        "code_interpreter_call.outputs",
        "web_search_call.results",
      ])
    }),
  )

  it.effect("passes forward-compatible includable values through", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "hi",
          providerOptions: { openai: { include: ["reasoning.encrypted_content", "bogus.thing"] } },
        }),
      )

      expect(prepared.body.include).toEqual(["reasoning.encrypted_content", "bogus.thing"])
    }),
  )

  it.effect("treats an explicit empty include as no include at all", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model, prompt: "hi", providerOptions: { openai: { include: [] } } }),
      )

      expect(prepared.body.include).toBeUndefined()
    }),
  )

  it.effect("passes an unknown includable value through", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model, prompt: "hi", providerOptions: { openai: { include: ["bogus.thing"] } } }),
      )

      expect(prepared.body.include).toEqual(["bogus.thing"])
    }),
  )

  it.effect("omits include when no include is set", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model, prompt: "hi", providerOptions: { openai: { store: false } } }),
      )

      expect(prepared.body.include).toBeUndefined()
    }),
  )

  it.effect("requests encrypted reasoning by default for GPT-5 reasoning models", () =>
    Effect.gen(function* () {
      // The native OpenAI facade configures GPT-5 stateless (store: false) with
      // reasoningSummary: "auto" by default. Without `include`, a follow-up
      // turn cannot replay reasoning state, so the facade also opts into
      // `reasoning.encrypted_content` automatically.
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-5.2"),
          prompt: "hi",
        }),
      )

      expect(prepared.body.store).toBe(false)
      expect(prepared.body.include).toEqual(["reasoning.encrypted_content"])
      expect(prepared.body.reasoning).toEqual({ effort: "medium", summary: "auto" })
    }),
  )

  it.effect("lets callers opt out of the GPT-5 default include", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-5.2"),
          prompt: "hi",
          providerOptions: { openai: { include: [] } },
        }),
      )

      expect(prepared.body.include).toBeUndefined()
    }),
  )

  it.effect("maps the request prompt cache key", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAI.configure({
            baseURL: "https://api.openai.test/v1/",
            apiKey: "test",
          }).model("gpt-4.1-mini"),
          prompt: "no cache",
          promptCacheKey: "request_cache",
        }),
      )

      expect(prepared.body.prompt_cache_key).toBe("request_cache")
    }),
  )

  it.effect("parses text and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Hello" },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "!" },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            service_tier: "default",
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 2,
        nonCachedInputTokens: 2,
        cacheReadInputTokens: 1,
        cacheWriteInputTokens: 2,
        reasoningTokens: 0,
        totalTokens: 7,
        providerMetadata: {
          openai: {
            input_tokens: 5,
            output_tokens: 2,
            total_tokens: 7,
            input_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      })

      expect(response.text).toBe("Hello!")
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "text-start", id: "msg_1" },
        { type: "text-delta", id: "msg_1", text: "Hello" },
        { type: "text-delta", id: "msg_1", text: "!" },
        { type: "text-end", id: "msg_1" },
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "stop", raw: undefined },
          providerMetadata: { openai: { responseId: "resp_1", serviceTier: "default" } },
          usage,
        },
        {
          type: "finish",
          reason: { normalized: "stop", raw: undefined },
          providerMetadata: { openai: { responseId: "resp_1", serviceTier: "default" } },
          usage,
        },
      ])
    }),
  )

  it.effect("preserves and replays assistant message phases", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "message", id: "msg_commentary" },
              },
              { type: "response.output_text.delta", item_id: "msg_commentary", delta: "Checking." },
              { type: "response.output_text.done", item_id: "msg_commentary" },
              {
                type: "response.output_item.done",
                item: { type: "message", id: "msg_commentary", phase: "commentary" },
              },
              {
                type: "response.output_item.added",
                item: { type: "message", id: "msg_final", phase: "final_answer" },
              },
              { type: "response.output_text.done", item_id: "msg_final", text: "Finished." },
              {
                type: "response.output_item.done",
                item: { type: "message", id: "msg_final", phase: "final_answer" },
              },
              { type: "response.output_item.added", item: { type: "message", id: "msg_null", phase: null } },
              { type: "response.output_text.delta", item_id: "msg_null", delta: "Unclassified." },
              { type: "response.output_item.done", item: { type: "message", id: "msg_null", phase: null } },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        {
          type: "text",
          text: "Checking.",
          providerMetadata: { openai: { phase: "commentary" } },
        },
        {
          type: "text",
          text: "Finished.",
          providerMetadata: { openai: { phase: "final_answer" } },
        },
        {
          type: "text",
          text: "Unclassified.",
          providerMetadata: { openai: { phase: null } },
        },
      ])

      const prepared = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(prepared.body.input).toEqual([
        {
          role: "assistant",
          content: [{ type: "output_text", text: "Checking." }],
          phase: "commentary",
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "Finished." }],
          phase: "final_answer",
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "Unclassified." }],
          phase: null,
        },
      ])
    }),
  )

  it.effect("rejects output text events without the spec-required item id", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_text.delta", delta: "orphaned" },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("response.output_text.delta is missing item_id")
    }),
  )

  it.effect("rejects reasoning events without the spec-required item id", () =>
    Effect.gen(function* () {
      const events = [
        { type: "response.reasoning_summary_part.added", summary_index: 0 },
        { type: "response.reasoning_summary_part.done", summary_index: 0 },
        { type: "response.reasoning_text.done" },
      ]

      for (const event of events) {
        const error = yield* LLMClient.generate(request).pipe(
          Effect.provide(fixedResponse(sseEvents(event, { type: "response.completed", response: { id: "resp_1" } }))),
          Effect.flip,
        )
        expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(error.message).toContain(`${event.type} is missing item_id`)
      }
    }),
  )

  it.effect("maps incomplete response reasons", () =>
    Effect.gen(function* () {
      const generate = (incompleteDetails: object) =>
        LLMClient.generate(request).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents({
                type: "response.incomplete",
                response: { id: "resp_incomplete", incomplete_details: incompleteDetails },
              }),
            ),
          ),
        )

      const length = yield* generate({ reason: "max_output_tokens" })
      const contentFilter = yield* generate({ reason: "content_filter" })
      const unknown = yield* generate({})
      const custom = yield* generate({ reason: "provider_limit" })

      expect([length.finishReason, contentFilter.finishReason, unknown.finishReason, custom.finishReason]).toEqual([
        { normalized: "length", raw: "max_output_tokens" },
        { normalized: "content-filter", raw: "content_filter" },
        { normalized: "unknown", raw: undefined },
        { normalized: "unknown", raw: "provider_limit" },
      ])
    }),
  )

  // OpenAI's documented stream orders output text within one message item; no
  // provider-valid same-kind overlap is evidenced, so done boundaries close it.
  it.effect("closes sequential output messages before starting the next", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_text.delta", item_id: "msg_1", delta: "First" },
              { type: "response.output_text.done", item_id: "msg_1" },
              { type: "response.output_text.delta", item_id: "msg_2", delta: "Second" },
              { type: "response.output_item.done", item: { type: "message", id: "msg_2" } },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.events.filter((event) => event.type.startsWith("text-"))).toEqual([
        { type: "text-start", id: "msg_1" },
        { type: "text-delta", id: "msg_1", text: "First" },
        { type: "text-end", id: "msg_1" },
        { type: "text-start", id: "msg_2" },
        { type: "text-delta", id: "msg_2", text: "Second" },
        { type: "text-end", id: "msg_2" },
      ])
    }),
  )

  it.effect("parses reasoning summary stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "thinking" },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Hello" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1" },
        { type: "response.completed", response: { id: "resp_1" } },
      )

      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.reasoning).toBe("thinking")
      expect(response.text).toBe("Hello")
      expect(response.events).toMatchObject([
        { type: "step-start", index: 0 },
        { type: "reasoning-start", id: "rs_1" },
        { type: "text-start", id: "msg_1" },
        { type: "text-delta", id: "msg_1", text: "Hello" },
        { type: "reasoning-delta", id: "rs_1", text: "thinking" },
        {
          type: "reasoning-end",
          id: "rs_1",
          providerMetadata: {
            openai: {
              itemId: "rs_1",
              reasoningEncryptedContent: null,
              reasoningItem: {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "thinking" }],
              },
            },
          },
        },
        { type: "text-end", id: "msg_1" },
        { type: "step-finish", index: 0, reason: { normalized: "stop", raw: undefined } },
        { type: "finish", reason: { normalized: "stop", raw: undefined } },
      ])
      expect(response.events.filter((event) => event.type === "finish")).toHaveLength(1)
      expect(response.message.content).toMatchObject([
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "Hello" },
      ])
    }),
  )

  it.effect("preserves encrypted reasoning metadata for continuation", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "thinking" },
              {
                type: "response.output_item.done",
                item: {
                  type: "reasoning",
                  id: "rs_1",
                  encrypted_content: "encrypted-state",
                  summary: [{ type: "summary_text", text: "thinking" }],
                },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.events).toContainEqual(
        expect.objectContaining({
          type: "reasoning-end",
          id: "rs_1",
          providerMetadata: {
            openai: {
              itemId: "rs_1",
              reasoningEncryptedContent: "encrypted-state",
              reasoningItem: {
                type: "reasoning",
                encrypted_content: "encrypted-state",
                summary: [{ type: "summary_text", text: "thinking" }],
              },
            },
          },
        }),
      )
    }),
  )

  it.effect("displays reasoning summaries and replays the native item", () =>
    Effect.gen(function* () {
      const reasoningItem = {
        type: "reasoning" as const,
        id: "rs_1",
        summary: [
          { type: "summary_text" as const, text: "Checked Codex." },
          { type: "summary_text" as const, text: "Checked Pi." },
        ],
        content: [
          { type: "reasoning_text" as const, text: "Raw Codex analysis." },
          { type: "reasoning_text" as const, text: "Raw Pi analysis." },
        ],
        encrypted_content: "encrypted-state",
        status: "completed",
        provider_extension: { trace: "native-value" },
      }
      const { id: _id, ...replayItem } = reasoningItem
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, { providerOptions: { openai: { store: false } } }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
              {
                type: "response.reasoning_text.delta",
                item_id: "rs_1",
                content_index: 0,
                delta: "Raw Codex analysis.",
              },
              {
                type: "response.reasoning_summary_text.delta",
                item_id: "rs_1",
                summary_index: 0,
                delta: "Checked Codex.",
              },
              { type: "response.output_item.done", item: reasoningItem },
              { type: "response.completed", response: { id: "resp_1", output: [reasoningItem] } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Checked Codex.\n\nChecked Pi.")
      expect(response.message.content).toEqual([
        {
          type: "reasoning",
          text: "Checked Codex.\n\nChecked Pi.",
          providerMetadata: {
            openai: {
              itemId: "rs_1",
              reasoningEncryptedContent: "encrypted-state",
              reasoningItem: replayItem,
            },
          },
        },
      ])

      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [response.message, Message.user("Continue.")],
          providerOptions: { openai: { store: false } },
        }),
      )
      expect(prepared.body.input).toEqual([
        replayItem,
        { role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ])
    }),
  )

  it.effect("uses raw reasoning when no summary is available", () =>
    Effect.gen(function* () {
      const reasoningItem = {
        type: "reasoning" as const,
        id: "rs_raw",
        summary: [],
        content: [
          { type: "reasoning_text" as const, text: "First raw part." },
          { type: "reasoning_text" as const, text: "Second raw part." },
        ],
        encrypted_content: "encrypted-state",
      }
      const { id: _id, ...replayItem } = reasoningItem
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", item: { type: "reasoning", id: "rs_raw" } },
              { type: "response.output_item.done", item: reasoningItem },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("First raw part.\n\nSecond raw part.")
      expect(response.message.content[0]).toMatchObject({
        type: "reasoning",
        text: "First raw part.\n\nSecond raw part.",
        providerMetadata: { openai: { reasoningItem: replayItem } },
      })
    }),
  )

  it.effect("preserves native reasoning for xAI Responses", () =>
    Effect.gen(function* () {
      const reasoningItem = {
        type: "reasoning" as const,
        id: "rs_xai",
        summary: [{ type: "summary_text" as const, text: "xAI summary." }],
        content: [{ type: "reasoning_text" as const, text: "xAI raw reasoning." }],
        encrypted_content: "xai-state",
      }
      const { id: _id, ...replayItem } = reasoningItem
      const response = yield* LLMClient.generate(LLM.request({ model: xaiModel, prompt: "Think." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.done", item: reasoningItem },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("xAI summary.")
      expect(response.message.content[0]).toMatchObject({
        providerMetadata: { xai: { reasoningItem: replayItem } },
      })
      const prepared = yield* compileRequest(
        LLM.request({ model: xaiModel, messages: [response.message, Message.user("Continue.")] }),
      )
      expect(prepared.body.input).toEqual([
        replayItem,
        { role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ])
    }),
  )

  it.effect("uses terminal reasoning output over a sparse item completion", () =>
    Effect.gen(function* () {
      const reasoningItem = {
        type: "reasoning" as const,
        id: "rs_terminal",
        summary: [{ type: "summary_text" as const, text: "Terminal summary." }],
        content: [{ type: "reasoning_text" as const, text: "Terminal raw content." }],
        encrypted_content: "encrypted-state",
      }
      const { id: _id, ...replayItem } = reasoningItem
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", item: { type: "reasoning", id: "rs_terminal" } },
              {
                type: "response.output_item.done",
                item: { type: "reasoning", id: "rs_terminal", encrypted_content: null },
              },
              { type: "response.completed", response: { id: "resp_1", output: [reasoningItem] } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Terminal summary.")
      expect(response.message.content[0]).toMatchObject({
        providerMetadata: { openai: { reasoningItem: replayItem } },
      })
    }),
  )

  it.effect("projects reasoning summary parts as one display block", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, { providerOptions: { openai: { store: false } } }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "reasoning", id: "rs_1", encrypted_content: null },
              },
              { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 0 },
              { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First" },
              { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 0 },
              { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
              { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Second" },
              { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 1 },
              {
                type: "response.output_item.done",
                item: { type: "reasoning", id: "rs_1", encrypted_content: "encrypted-state" },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("First\n\nSecond")
      expect(response.events).toMatchObject([
        { type: "step-start", index: 0 },
        {
          type: "reasoning-start",
          id: "rs_1",
          providerMetadata: { openai: { itemId: "rs_1" } },
        },
        { type: "reasoning-delta", id: "rs_1", text: "First\n\nSecond" },
        {
          type: "reasoning-end",
          id: "rs_1",
          providerMetadata: {
            openai: {
              itemId: "rs_1",
              reasoningEncryptedContent: "encrypted-state",
              reasoningItem: {
                type: "reasoning",
                encrypted_content: "encrypted-state",
                summary: [
                  { type: "summary_text", text: "First" },
                  { type: "summary_text", text: "Second" },
                ],
              },
            },
          },
        },
        { type: "step-finish", index: 0, reason: { normalized: "stop", raw: undefined } },
        { type: "finish", reason: { normalized: "stop", raw: undefined } },
      ])
    }),
  )

  it.effect("closes the reasoning item when storage is not disabled", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, { providerOptions: { openai: { store: true } } }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "reasoning", id: "rs_1", encrypted_content: null },
              },
              { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 0 },
              { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First" },
              { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 0 },
              { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
              { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Second" },
              { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 1 },
              {
                type: "response.output_item.done",
                item: { type: "reasoning", id: "rs_1", encrypted_content: null },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.events.filter((event) => event.type === "reasoning-end")).toEqual([
        {
          type: "reasoning-end",
          id: "rs_1",
          providerMetadata: {
            openai: {
              itemId: "rs_1",
              reasoningEncryptedContent: null,
              reasoningItem: {
                type: "reasoning",
                encrypted_content: null,
                summary: [
                  { type: "summary_text", text: "First" },
                  { type: "summary_text", text: "Second" },
                ],
              },
            },
          },
        },
      ])
    }),
  )

  it.effect("continues a stateless reasoning conversation", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "req_reasoning_continue",
          model,
          messages: [
            Message.user("What changed?"),
            Message.assistant([
              {
                type: "reasoning",
                text: "Checked the previous diff.",
                providerMetadata: {
                  openai: {
                    itemId: "rs_1",
                    reasoningEncryptedContent: "encrypted-state",
                  },
                },
              },
              { type: "text", text: "The parser changed." },
            ]),
            Message.user("Summarize it."),
          ],
          providerOptions: { openai: { store: false } },
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              const body = yield* Effect.promise(() => web.json())
              expect(body).toMatchObject({
                input: [
                  { role: "user", content: [{ type: "input_text", text: "What changed?" }] },
                  {
                    type: "reasoning",
                    encrypted_content: "encrypted-state",
                    summary: [{ type: "summary_text", text: "Checked the previous diff." }],
                  },
                  { role: "assistant", content: [{ type: "output_text", text: "The parser changed." }] },
                  { role: "user", content: [{ type: "input_text", text: "Summarize it." }] },
                ],
              })
              expect(body.input[1]).not.toHaveProperty("id")
              return input.respond(
                sseEvents(
                  { type: "response.output_text.delta", item_id: "msg_1", delta: "Parser now round-trips reasoning." },
                  { type: "response.completed", response: { id: "resp_1" } },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Parser now round-trips reasoning.")
    }),
  )

  it.effect("preserves assistant content order around reasoning items", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_reasoning_order",
          model,
          messages: [
            Message.assistant([
              { type: "text", text: "Before." },
              {
                type: "reasoning",
                text: "Checked order.",
                providerMetadata: {
                  openai: {
                    itemId: "rs_1",
                    reasoningEncryptedContent: "encrypted-state",
                  },
                },
              },
              { type: "text", text: "After." },
            ]),
          ],
          providerOptions: { openai: { store: false } },
        }),
      )

      expect(prepared.body.input).toEqual([
        { role: "assistant", content: [{ type: "output_text", text: "Before." }] },
        {
          type: "reasoning",
          encrypted_content: "encrypted-state",
          summary: [{ type: "summary_text", text: "Checked order." }],
        },
        { role: "assistant", content: [{ type: "output_text", text: "After." }] },
      ])
    }),
  )

  it.effect("references stored reasoning items by id", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "Checked the previous diff.",
                providerMetadata: { openai: { itemId: "rs_1" } },
              },
            ]),
          ],
          providerOptions: { openai: { store: true } },
        }),
      )

      expect(prepared.body.input).toEqual([{ type: "item_reference", id: "rs_1" }])
    }),
  )

  it.effect("references stored provider-executed hosted tool results by id", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              ToolCallPart.make({
                id: "ws_1",
                name: "web_search",
                input: { query: "effect 4" },
                providerExecuted: true,
                providerMetadata: { openai: { itemId: "ws_1" } },
              }),
              {
                type: "tool-result",
                id: "ws_1",
                name: "web_search",
                result: { type: "json", value: { type: "web_search_call", id: "ws_1", status: "completed" } },
                providerExecuted: true,
                providerMetadata: { openai: { itemId: "ws_1" } },
              },
            ]),
            Message.user("Continue."),
          ],
          providerOptions: { openai: { store: true } },
        }),
      )

      expect(prepared.body.input).toEqual([
        { type: "item_reference", id: "ws_1" },
        { role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ])
    }),
  )

  it.effect("continues stateless hosted image generation with the generated image", () =>
    Effect.gen(function* () {
      const imageTool = OpenAI.imageGeneration({ action: "edit" })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Generate a black triangle."),
            Message.assistant([
              ToolCallPart.make({
                id: "ig_1",
                name: "image_generation",
                input: {},
                providerExecuted: true,
                providerMetadata: { openai: { itemId: "ig_1" } },
              }),
              ToolResultPart.make({
                id: "ig_1",
                name: "image_generation",
                result: {
                  type: "content",
                  value: [{ type: "file", uri: "data:image/png;base64,AQID", mime: "image/png" }],
                },
                providerExecuted: true,
                providerMetadata: { openai: { itemId: "ig_1" } },
              }),
            ]),
            Message.user("Make it blue."),
          ],
          tools: [imageTool],
        }),
      )

      expect(prepared.body.store).toBe(false)
      expect(prepared.body.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "Generate a black triangle." }] },
        { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AQID" }] },
        { role: "user", content: [{ type: "input_text", text: "Make it blue." }] },
      ])
    }),
  )

  it.effect("joins streamed summary blocks into one continuation reasoning item", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_multi_summary_continuation",
          model,
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "First",
                providerMetadata: { openai: { itemId: "rs_1" } },
              },
              {
                type: "reasoning",
                text: "Second",
                providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
              },
            ]),
          ],
          providerOptions: { openai: { store: false } },
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          type: "reasoning",
          encrypted_content: "encrypted-state",
          summary: [
            { type: "summary_text", text: "First" },
            { type: "summary_text", text: "Second" },
          ],
        },
      ])
    }),
  )

  it.effect("skips non-persisted reasoning ids without encrypted state", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_reasoning_without_encrypted_state",
          model,
          messages: [
            Message.user("What changed?"),
            Message.assistant([
              {
                type: "reasoning",
                text: "Checked the previous diff.",
                providerMetadata: {
                  openai: {
                    itemId: "rs_1",
                    reasoningEncryptedContent: null,
                  },
                },
              },
              { type: "text", text: "The parser changed." },
            ]),
            Message.user("Summarize it."),
          ],
          providerOptions: { openai: { store: false } },
        }),
      )

      expect(prepared.body).toMatchObject({
        input: [
          { role: "user", content: [{ type: "input_text", text: "What changed?" }] },
          { role: "assistant", content: [{ type: "output_text", text: "The parser changed." }] },
          { role: "user", content: [{ type: "input_text", text: "Summarize it." }] },
        ],
        store: false,
      })
    }),
  )

  it.effect("assembles streamed function call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          type: "response.output_item.added",
          item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" },
        },
        { type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"query"' },
        { type: "response.function_call_arguments.delta", item_id: "item_1", delta: ':"weather"}' },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "item_1",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"query":"weather"}',
          },
        },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 1,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: undefined,
        reasoningTokens: undefined,
        totalTokens: 6,
        providerMetadata: { openai: { input_tokens: 5, output_tokens: 1 } },
      })

      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        {
          type: "tool-input-start",
          id: "call_1",
          name: "lookup",
          providerMetadata: { openai: { itemId: "item_1" } },
        },
        {
          type: "tool-input-delta",
          id: "call_1",
          name: "lookup",
          text: '{"query"',
        },
        {
          type: "tool-input-delta",
          id: "call_1",
          name: "lookup",
          text: ':"weather"}',
        },
        {
          type: "tool-input-end",
          id: "call_1",
          name: "lookup",
          providerMetadata: { openai: { itemId: "item_1" } },
        },
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: { openai: { itemId: "item_1" } },
        },
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "tool-calls", raw: undefined },
          usage,
          providerMetadata: undefined,
        },
        {
          type: "finish",
          reason: { normalized: "tool-calls", raw: undefined },
          providerMetadata: undefined,
          usage,
        },
      ])
    }),
  )

  it.effect("emits malformed final function arguments as an unexecuted tool error", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          type: "response.output_item.added",
          item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" },
        },
        { type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"query":"streamed"}' },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "item_1",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"query":"partial',
          },
        },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.events.find(LLMEvent.is.toolInputError)).toEqual({
        type: "tool-input-error",
        id: "call_1",
        name: "lookup",
        raw: '{"query":"partial',
      })
      expect(response.finishReason.normalized).toBe("tool-calls")
      expect(response.events.some(LLMEvent.is.toolCall)).toBeFalse()
    }),
  )

  it.effect("settles malformed function arguments when output_item.added is absent", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "item_1",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"query":"partial',
          },
        },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.events.find(LLMEvent.is.toolInputError)).toMatchObject({
        id: "call_1",
        name: "lookup",
        raw: '{"query":"partial',
      })
      expect(response.finishReason.normalized).toBe("tool-calls")
    }),
  )

  it.effect("decodes web_search_call as provider-executed tool-call + tool-result", () =>
    Effect.gen(function* () {
      const item = {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "effect 4" },
      }
      const body = sseEvents(
        { type: "response.output_item.added", item },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      const callsAndResults = response.events.filter(
        (event) => event.type === "tool-call" || event.type === "tool-result",
      )
      expect(callsAndResults).toEqual([
        {
          type: "tool-call",
          id: "ws_1",
          name: "web_search",
          input: { type: "search", query: "effect 4" },
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "ws_1" } },
        },
        {
          type: "tool-result",
          id: "ws_1",
          name: "web_search",
          result: { type: "json", value: item },
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "ws_1" } },
        },
      ])
    }),
  )

  it.effect("decodes image generation output as image content", () =>
    Effect.gen(function* () {
      const item = {
        type: "image_generation_call",
        id: "ig_1",
        status: "completed",
        result: "AQID",
      }
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.done", item },
              { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
            ),
          ),
        ),
      )

      expect(response.events.find(LLMEvent.is.toolResult)).toMatchObject({
        id: "ig_1",
        name: "image_generation",
        providerExecuted: true,
        result: {
          type: "content",
          value: [{ type: "file", uri: "data:image/png;base64,AQID", mime: "image/png" }],
        },
      })
    }),
  )

  it.effect("rejects malformed image generation base64", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.done",
                item: { type: "image_generation_call", id: "ig_bad", status: "completed", result: "%%%" },
              },
              { type: "response.completed", response: {} },
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("invalid image base64")
    }),
  )

  it.effect("decodes code_interpreter_call as provider-executed events with code input", () =>
    Effect.gen(function* () {
      const item = {
        type: "code_interpreter_call",
        id: "ci_1",
        status: "completed",
        code: "print(1+1)",
        container_id: "cnt_xyz",
        outputs: [{ type: "logs", logs: "2\n" }],
      }
      const body = sseEvents(
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      const toolCall = response.events.find((event) => event.type === "tool-call")
      expect(toolCall).toEqual({
        type: "tool-call",
        id: "ci_1",
        name: "code_interpreter",
        input: { code: "print(1+1)", container_id: "cnt_xyz" },
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "ci_1" } },
      })
      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toEqual({
        type: "tool-result",
        id: "ci_1",
        name: "code_interpreter",
        result: { type: "json", value: item },
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "ci_1" } },
      })
    }),
  )

  it.effect("lowers user image and PDF content", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_media",
          model,
          messages: [
            Message.user([
              { type: "media", mediaType: "image/png", data: "AAECAw==" },
              { type: "media", mediaType: "application/pdf", data: "JVBERi0xLjQ=", filename: "report.pdf" },
            ]),
          ],
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
            {
              type: "input_file",
              filename: "report.pdf",
              file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
            },
          ],
        },
      ])
    }),
  )

  it.effect("uses xAI inline file encoding for user PDFs", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: xaiModel,
          messages: [
            Message.user({
              type: "media",
              mediaType: "application/pdf",
              data: "data:application/pdf;base64,JVBERi0xLjQ=",
              filename: "report.pdf",
            }),
          ],
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "report.pdf",
              file_data: "JVBERi0xLjQ=",
              mime_type: "application/pdf",
            },
          ],
        },
      ])
    }),
  )

  it.effect("passes non-image user media through as an input file", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_media",
          model,
          messages: [Message.user({ type: "media", mediaType: "application/x-tar", data: "AAECAw==" })],
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "file",
              file_data: "data:application/x-tar;base64,AAECAw==",
            },
          ],
        },
      ])
    }),
  )

  it.effect("fails with a typed rate limit for provider error frames", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error", code: "rate_limit_exceeded", message: "Slow down" }))),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "RateLimit", message: "rate_limit_exceeded: Slow down" })
    }),
  )

  it.effect("falls back to error code when no message is present", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error", code: "internal_error" }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", message: "internal_error" })
    }),
  )

  it.effect("falls back to error code when message is empty", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error", code: "internal_error", message: "" }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", message: "internal_error" })
    }),
  )

  // Regression: `response.failed` carries the failure details under
  // `response.error`, not at the top level. The previous handler only
  // checked top-level `message`/`code` and so always emitted the bare
  // "OpenAI Responses response failed" string, hiding the real cause.
  it.effect("surfaces response.failed details from response.error", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "response.failed",
              response: {
                id: "resp_failed_1",
                error: { code: "server_error", message: "Upstream model unavailable" },
              },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "ProviderInternal",
        message: "server_error: Upstream model unavailable",
      })
    }),
  )

  it.effect("surfaces response.failed code when no nested message is present", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "response.failed",
              response: { id: "resp_failed_2", error: { code: "invalid_prompt" } },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", message: "invalid_prompt" })
    }),
  )

  it.effect("surfaces error event details nested under response.error", () =>
    Effect.gen(function* () {
      // Some OpenAI-compatible proxies and older SDK versions wrap the
      // top-level error fields into a nested `response.error` payload
      // when they bubble up an HTTP error as an SSE `error` event. Honour
      // both shapes so the user still sees the underlying cause instead
      // of the catch-all string.
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "error",
              response: { error: { code: "context_length_exceeded", message: "prompt too long" } },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "context_length_exceeded: prompt too long",
        classification: "context-overflow",
      })
    }),
  )

  it.effect("surfaces error event details nested under error", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "error",
              sequence_number: 2,
              error: {
                type: "invalid_request_error",
                code: "context_length_exceeded",
                message: "prompt too long",
                param: "input",
              },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "context_length_exceeded: prompt too long",
        classification: "context-overflow",
      })
    }),
  )

  it.effect("accepts nullable fields in spec-compliant error events", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "error",
              code: null,
              message: "Something went wrong",
              param: null,
              sequence_number: 1,
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "Something went wrong" })
    }),
  )

  it.effect("falls back to a stable default when error is null", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error", error: null }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "OpenAI Responses stream error" })
    }),
  )

  it.effect("falls back to a stable default when both error and response are absent", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error" }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "OpenAI Responses stream error" })
    }),
  )

  it.effect("falls back to a stable default when response.failed has no error payload", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "response.failed", response: { id: "resp_failed_3" } }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "OpenAI Responses response failed" })
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse('{"error":{"type":"invalid_request_error","message":"Bad request"}}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        ),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", message: "Bad request" })
    }),
  )
})
