import { expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/http"
import { ai, Auth, LLMClient, Message, ReasoningPart, ToolDefinition } from "../../src/effect.js"
import { Moonshot } from "../../src/providers/moonshot.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

it.effect("Moonshot composes shared protocols with explicit endpoints and bearer authentication", () =>
  Effect.gen(function* () {
    expect(Moonshot.model("kimi-k3").api.name).toBe("chat-completions")
    expect(Moonshot.messagesModel("kimi-k3").api.protocol.body).toBe(AnthropicMessages.protocol.body)
    expect(Moonshot.responsesModel("kimi-k3").api.protocol.body).toBe(OpenResponses.protocol.body)
    for (const item of [
      { model: Moonshot.model("kimi-k3"), path: "/v1/chat/completions" },
      { model: Moonshot.messagesModel("kimi-k3"), path: "/anthropic/v1/messages" },
      { model: Moonshot.responsesModel("kimi-k3"), path: "/v1/responses" },
    ]) {
      const request = ai.request({ model: item.model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      const url = Endpoint.render(
        { baseURL: item.model.baseURL, path: item.model.api.path, query: item.model.query },
        { request, body: compiled.body },
      ).toString()
      expect(url).toBe(`https://api.moonshot.ai${item.path}`)
      expect(item.model.provider as string).toBe("moonshotai")
      expect(item.model.metadataKey).toBe("moonshot")
      const headers = yield* item.model.auth.apply({
        request,
        method: "POST",
        url,
        body: "{}",
        headers: Headers.empty,
      })
      expect(headers.authorization).toBe("Bearer primary")
    }
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: { MOONSHOT_API_KEY: "primary", MOONSHOTAI_API_KEY: "fallback" } }),
      ),
    ),
  ),
)

it.effect("Moonshot preserves default reasoning across model IDs on custom endpoints", () =>
  Effect.gen(function* () {
    const moonshot = Moonshot.moonshot.with({
      baseURL: "https://gateway.example/v1",
      auth: Auth.header("x-api-key", "fixture"),
    })
    for (const id of ["kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k3", "future-model"]) {
      const model = moonshot.model(id)
      const request = ai.request({ model, prompt: "Hello", maxTokens: 100 })
      const compiled = yield* compileRequest(request)
      expect(compiled.body).toMatchObject({ model: id, max_tokens: 100, stream: true })
      expect(compiled.body.max_completion_tokens).toBeUndefined()
      expect(compiled.body.store).toBeUndefined()
      expect(compiled.body.thinking).toBeUndefined()
      expect(compiled.body.reasoning_effort).toBeUndefined()
      expect(model.baseURL).toBe("https://gateway.example/v1")
      const headers = yield* model.auth.apply({
        request,
        method: "POST",
        url: "https://gateway.example/v1/chat/completions",
        body: "{}",
        headers: Headers.empty,
      })
      expect(headers["x-api-key"]).toBe("fixture")
      expect(headers.authorization).toBeUndefined()
    }
  }),
)

it.effect("Moonshot honors fallback credentials and final HTTP body overlays", () =>
  LLMClient.generate(
    ai.request({
      model: Moonshot.responsesModel("kimi-k3", { reasoningEffort: "high" }),
      prompt: "Hello",
      providerOptions: { reasoningEffort: "low" },
      http: { body: { reasoning: { effort: "max" }, future_option: true } },
    }),
  ).pipe(
    Effect.provide(
      dynamicResponse((input) =>
        Effect.sync(() => {
          expect(input.request.headers.authorization).toBe("Bearer fallback")
          expect(JSON.parse(input.text)).toMatchObject({ reasoning: { effort: "max" }, future_option: true })
          return input.respond(sseEvents({ type: "response.completed", response: {} }), {
            headers: { "content-type": "text/event-stream" },
          })
        }),
      ),
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { MOONSHOTAI_API_KEY: "fallback" } }))),
  ),
)

it.effect("Moonshot lowers API-specific reasoning options without adding unrelated controls", () =>
  Effect.gen(function* () {
    for (const thinking of [{ type: "disabled" }, { type: "enabled", keep: "all" }, { type: "enabled", keep: null }]) {
      const result = yield* compileRequest(
        ai.request({
          model: Moonshot.model("kimi-k2.6", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { thinking },
        }),
      )
      expect(result.body.thinking).toEqual(thinking)
      expect(result.body.reasoning_effort).toBeUndefined()
    }
    for (const effort of ["low", "high", "max", "future-effort"]) {
      const chat = yield* compileRequest(
        ai.request({
          model: Moonshot.model("kimi-k3", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { reasoningEffort: effort },
        }),
      )
      const messages = yield* compileRequest(
        ai.request({
          model: Moonshot.messagesModel("kimi-k3", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { effort },
        }),
      )
      const responses = yield* compileRequest(
        ai.request({
          model: Moonshot.responsesModel("kimi-k3", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { reasoningEffort: effort },
        }),
      )
      expect(chat.body.reasoning_effort).toBe(effort)
      expect(messages.body.output_config).toEqual({ effort })
      expect(responses.body.reasoning).toEqual({ effort })
      for (const compiled of [chat, messages, responses]) expect(compiled.body.thinking).toBeUndefined()
      expect(responses.body.store).toBeUndefined()
      expect(responses.body.include).toBeUndefined()
    }
  }),
)

it.effect("Moonshot validates native Chat thinking options", () =>
  Effect.gen(function* () {
    const invalid = Moonshot.moonshot
      .with({ apiKey: "fixture", providerOptions: { thinking: { type: "enabled", keep: 42 } } })
      .model("kimi-k2.6")
    const failure = yield* compileRequest(ai.request({ model: invalid, prompt: "Hello" })).pipe(Effect.flip)
    expect(failure.reason._tag).toBe("InvalidRequest")
    expect(failure.message).toContain("keep")
  }),
)

it.effect("Moonshot retains unsigned and signed Messages reasoning and projects tool schemas", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      ai.request({
        model: Moonshot.messagesModel("kimi-k3", { apiKey: "fixture" }),
        messages: [
          Message.user("Hello"),
          Message.assistant([
            ReasoningPart.make({ type: "reasoning", text: "Unsigned" }),
            ReasoningPart.make({
              type: "reasoning",
              text: "Signed",
              providerMetadata: { moonshot: { signature: "opaque-signature" } },
            }),
          ]),
        ],
        tools: [
          ToolDefinition.make({
            name: "lookup",
            description: "Look up a pair",
            inputSchema: {
              type: "object",
              properties: { pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] } },
            },
          }),
        ],
      }),
    )
    expect(compiled.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Unsigned", signature: "" },
            { type: "thinking", thinking: "Signed", signature: "opaque-signature" },
          ],
        }),
      ]),
    )
    expect(compiled.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_schema: {
            type: "object",
            properties: { pair: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } } },
          },
        }),
      ]),
    )
  }),
)

it.effect("Moonshot Responses uses HTTP even with a WebSocket executor", () =>
  LLMClient.generate(
    ai.request({ model: Moonshot.responsesModel("kimi-k3", { apiKey: "fixture" }), prompt: "Hello" }),
    {
      webSocket: { execute: () => Effect.die("Unexpected WebSocket request") },
    },
  ).pipe(
    Effect.provide(
      dynamicResponse((input) =>
        Effect.sync(() => {
          expect(input.request.url).toBe("https://api.moonshot.ai/v1/responses")
          return input.respond(sseEvents({ type: "response.completed", response: {} }), {
            headers: { "content-type": "text/event-stream" },
          })
        }),
      ),
    ),
  ),
)
