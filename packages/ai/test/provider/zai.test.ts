import { expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Auth, LLM, LLMClient, Message, ReasoningPart, ToolDefinition } from "../../src/index.js"
import { ZAI, ZAICodingPlan } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const tool = ToolDefinition.make({
  name: "lookup",
  description: "Look up a value",
  inputSchema: { type: "object", properties: { key: { type: "string" } } },
})

it.effect("ZAI owns standard and Coding Plan endpoints and bearer credentials", () =>
  Effect.gen(function* () {
    expect(ZAI.provider.model).toBe(ZAI.provider.chat)
    expect(ZAICodingPlan.provider.model).toBe(ZAICodingPlan.provider.chat)
    for (const item of [
      { model: ZAI.chat("glm-5.3"), path: "/paas/v4/chat/completions", provider: "zai" },
      { model: ZAICodingPlan.chat("glm-5.3"), path: "/coding/paas/v4/chat/completions", provider: "zai-coding-plan" },
      { model: ZAICodingPlan.messages("glm-5.3"), path: "/anthropic/v1/messages", provider: "zai-coding-plan" },
      { model: ZAICodingPlan.responses("glm-5.3"), path: "/v1/responses", provider: "zai-coding-plan" },
    ]) {
      const request = LLM.request({ model: item.model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      const url = Endpoint.render(item.model.route.endpoint, { request, body: compiled.body }).toString()
      expect(url).toBe(`https://api.z.ai/api${item.path}`)
      expect(item.model.provider).toBe(item.provider)
      expect(item.model.route.providerMetadataKey).toBe("zai")
      expect(compiled.body.thinking).toBeUndefined()
      expect(compiled.body.reasoning_effort).toBeUndefined()
      expect(compiled.body.reasoning).toBeUndefined()
      expect(compiled.body.output_config).toBeUndefined()
      const headers = yield* item.model.route.auth.apply({
        request,
        method: "POST",
        url,
        body: "{}",
        headers: Headers.empty,
      })
      expect(headers.authorization).toBe("Bearer fixture")
    }
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ZAI_API_KEY: "fixture" } })))),
)

it.effect("ZAI Chat retains native thinking fields and scopes tool streaming to supported models", () =>
  Effect.gen(function* () {
    for (const configure of [ZAI.configure, ZAICodingPlan.configure]) {
      const provider = configure({
        baseURL: "https://gateway.example/custom",
        auth: Auth.header("x-test-key", "fixture"),
      })
      for (const modelID of [
        "glm-4.5",
        "glm-4.5-air",
        "glm-4.5-x",
        "glm-4.6",
        "glm-4.7-flash",
        "glm-5.3",
        "glm-5.3-flash",
        "future-model",
      ]) {
        const result = yield* compileRequest(
          LLM.request({
            model: provider.chat(modelID),
            prompt: "Hello",
            generation: { maxTokens: 123 },
            tools: [tool],
            providerOptions: { thinking: { type: "enabled", clear_thinking: false } },
          }),
        )
        expect(result.body).toMatchObject({
          model: modelID,
          max_tokens: 123,
          thinking: { type: "enabled", clear_thinking: false },
        })
        expect(result.body.tool_stream).toBe(
          ["glm-4.6", "glm-4.7-flash", "glm-5.3", "glm-5.3-flash"].includes(modelID) ? true : undefined,
        )
        expect(result.body.max_completion_tokens).toBeUndefined()
        expect(result.body.store).toBeUndefined()
        expect(result.body.tools).toEqual([
          expect.objectContaining({ function: expect.not.objectContaining({ strict: expect.anything() }) }),
        ])
      }
      for (const thinking of [
        undefined,
        { type: "disabled" },
        { clear_thinking: false },
        { type: "enabled", clear_thinking: true },
      ]) {
        const result = yield* compileRequest(
          LLM.request({
            model: provider.chat("glm-5.2"),
            providerOptions: {
              thinking,
              toolStream: false,
              doSample: false,
              responseFormat: { type: "json_object" },
              requestID: "request-1",
              userID: "user-1",
            },
            tools: [tool],
          }),
        )
        expect(result.body.thinking).toEqual(thinking)
        expect(result.body).toMatchObject({
          tool_stream: false,
          do_sample: false,
          response_format: { type: "json_object" },
          request_id: "request-1",
          user_id: "user-1",
        })
      }
    }
  }),
)

it.effect("ZAI lowers effort using the selected native API without inventing thinking settings", () =>
  Effect.gen(function* () {
    for (const effort of ["low", "high", "max", "none", "minimal", "medium", "xhigh", "future-effort"]) {
      const standard = yield* compileRequest(
        LLM.request({
          model: ZAI.configure({ apiKey: "fixture" }).chat("glm-5.3"),
          providerOptions: { reasoningEffort: effort },
        }),
      )
      const coding = ZAICodingPlan.configure({ apiKey: "fixture" })
      const chat = yield* compileRequest(
        LLM.request({ model: coding.chat("glm-5.3"), providerOptions: { reasoningEffort: effort } }),
      )
      const messages = yield* compileRequest(
        LLM.request({ model: coding.messages("glm-5.3"), providerOptions: { effort } }),
      )
      const responses = yield* compileRequest(
        LLM.request({ model: coding.responses("glm-5.3"), providerOptions: { reasoningEffort: effort } }),
      )
      expect(standard.body.reasoning_effort).toBe(effort)
      expect(chat.body.reasoning_effort).toBe(effort)
      expect(messages.body.output_config).toEqual({ effort })
      expect(responses.body.reasoning).toEqual({ effort })
      for (const result of [standard, chat, messages, responses]) expect(result.body.thinking).toBeUndefined()
    }
    for (const type of ["enabled", "adaptive", "disabled"]) {
      const result = yield* compileRequest(
        LLM.request({
          model: ZAICodingPlan.configure({ apiKey: "fixture", providerOptions: { thinking: { type } } }).messages(
            "glm-5.3",
          ),
        }),
      )
      expect(result.body.thinking).toEqual({ type })
    }
  }),
)

it.effect("ZAI rejects invalid typed thinking options before execution", () =>
  Effect.gen(function* () {
    const model = ZAI.configure({ apiKey: "fixture" })
      .chat("glm-5.3")
      .route.with({ providerOptions: { thinking: { clear_thinking: "false" } } })
      .model({ id: "glm-5.3" })
    const error = yield* compileRequest(LLM.request({ model })).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidRequest")
    expect(error.message).toContain("clear_thinking")
  }),
)

it.effect("ZAI preserves unsigned and signed Messages reasoning", () =>
  Effect.gen(function* () {
    const result = yield* compileRequest(
      LLM.request({
        model: ZAICodingPlan.configure({ apiKey: "fixture" }).messages("glm-5.3"),
        messages: [
          Message.user("Hello"),
          Message.assistant([
            ReasoningPart.make({ type: "reasoning", text: "unsigned" }),
            ReasoningPart.make({
              type: "reasoning",
              text: "signed",
              providerMetadata: { zai: { signature: "opaque" } },
            }),
          ]),
        ],
      }),
    )
    expect(result.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: [
            { type: "thinking", thinking: "unsigned", signature: "" },
            { type: "thinking", thinking: "signed", signature: "opaque" },
          ],
        }),
      ]),
    )
  }),
)

it.effect("ZAI applies configured options, request options, and final body overlays in order", () =>
  LLMClient.generate(
    LLM.request({
      model: ZAI.configure({
        apiKey: "fixture",
        baseURL: "https://gateway.example/custom",
        providerOptions: { thinking: { type: "enabled", clear_thinking: true }, reasoningEffort: "high" },
      }).chat("glm-5.3"),
      prompt: "Hello",
      providerOptions: { thinking: { clear_thinking: false }, reasoningEffort: "low" },
      http: { body: { reasoning_effort: "max", extension: true } },
    }),
  ).pipe(
    Effect.provide(
      dynamicResponse((input) =>
        Effect.sync(() => {
          expect(input.request.url).toBe("https://gateway.example/custom/chat/completions")
          expect(input.request.headers.authorization).toBe("Bearer fixture")
          expect(JSON.parse(input.text)).toMatchObject({
            thinking: { type: "enabled", clear_thinking: false },
            reasoning_effort: "max",
            extension: true,
          })
          return input.respond(
            sseEvents({ choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] }, "[DONE]"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      ),
    ),
  ),
)

it.effect("ZAI Coding Responses uses HTTP with a supplied WebSocket executor", () =>
  LLMClient.generate(
    LLM.request({ model: ZAICodingPlan.configure({ apiKey: "fixture" }).responses("glm-5.3"), prompt: "Hello" }),
    {
      webSocket: { execute: () => Effect.die("Unexpected WebSocket") },
    },
  ).pipe(
    Effect.provide(
      dynamicResponse((input) =>
        Effect.sync(() => {
          expect(input.request.url).toBe("https://api.z.ai/api/v1/responses")
          return input.respond(sseEvents({ type: "response.completed", response: {} }), {
            headers: { "content-type": "text/event-stream" },
          })
        }),
      ),
    ),
  ),
)

it.effect("ZAI Coding Messages serializes enabled thinking without a token budget", () =>
  LLMClient.generate(
    LLM.request({
      model: ZAICodingPlan.configure({
        apiKey: "fixture",
        baseURL: "https://gateway.example/messages/v1",
        providerOptions: { thinking: { type: "enabled" }, effort: "max" },
      }).messages("glm-5.3"),
      prompt: "Hello",
      providerOptions: { effort: "high" },
    }),
  ).pipe(
    Effect.provide(
      dynamicResponse((input) =>
        Effect.sync(() => {
          expect(input.request.url).toBe("https://gateway.example/messages/v1/messages")
          expect(input.request.headers.authorization).toBe("Bearer fixture")
          expect(input.request.headers["anthropic-version"]).toBe("2023-06-01")
          expect(JSON.parse(input.text)).toMatchObject({
            thinking: { type: "enabled" },
            output_config: { effort: "high" },
          })
          return input.respond(
            sseEvents(
              {
                type: "message_start",
                message: {
                  id: "msg_fixture",
                  role: "assistant",
                  model: "glm-5.3",
                  content: [],
                  usage: { input_tokens: 1, output_tokens: 0 },
                },
              },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      ),
    ),
  ),
)
