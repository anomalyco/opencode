import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { LLM, LanguageModel, Message } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AISDK } from "../src/aisdk"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)
const client = LLMClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      RequestExecutor.Service,
      RequestExecutor.Service.of({ execute: () => Effect.die("Unexpected native HTTP request") }),
    ),
  ),
)
const chunk =
  'data: {"id":"r","object":"chat.completion.chunk","created":0,"model":"api-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

it.effect("overrides the AI SDK request URL without changing the original model", () =>
  Effect.gen(function* () {
    const sent: string[] = []
    const aisdk = yield* AISDK.Service
    yield* aisdk.hook.sdk((event) => {
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const resolved = yield* aisdk.model({
      ...Model.Info.make({
        ...Model.Info.default(Provider.ID.make("probe"), Model.ID.make("api-model")),
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
      }),
      settings: {
        baseURL: "https://original.example.invalid/v1",
        apiKey: "test",
        fetch: Object.assign(
          async (input: string | URL | Request) => {
            sent.push(input instanceof Request ? input.url : String(input))
            return new Response(chunk, { headers: { "content-type": "text/event-stream" } })
          },
          { preconnect: fetch.preconnect },
        ),
      },
    })
    const selected = LanguageModel.update(resolved, {
      route: resolved.route.with({ endpoint: { baseURL: "https://replacement.example.invalid/custom/v2/" } }),
    })
    yield* LLMClient.generate(LLM.request({ model: selected, messages: [Message.user("hello")] })).pipe(
      Effect.provide(client),
    )
    yield* LLMClient.generate(LLM.request({ model: resolved, messages: [Message.user("control")] })).pipe(
      Effect.provide(client),
    )
    expect(sent).toEqual([
      "https://replacement.example.invalid/custom/v2/chat/completions",
      "https://original.example.invalid/v1/chat/completions",
    ])
  }),
)
