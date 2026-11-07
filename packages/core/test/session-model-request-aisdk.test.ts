import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Message } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { AISDK } from "../src/aisdk"
import { Location } from "../src/location"
import { Model } from "../src/model"
import { PluginHooks } from "../src/plugin/hooks"
import { Project } from "../src/project"
import { Provider } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { SessionModelRequest } from "../src/session/model-request"
import { SessionModelTransport } from "../src/session/model-transport"
import { SessionRunnerModel } from "../src/session/runner/model"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const client = LLMClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      RequestExecutor.Service,
      RequestExecutor.Service.of({ execute: () => Effect.die("Unexpected native HTTP request") }),
    ),
  ),
)
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})
const session = Session.Info.make({
  id: Session.ID.make("ses_aisdk_model_hook"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const chunk =
  'data: {"id":"r","object":"chat.completion.chunk","created":0,"model":"api-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

it.effect("applies a session model.request hook to the AI SDK request URL", () =>
  Effect.gen(function* () {
    const aisdk = yield* AISDK.Service
    const hooks = yield* PluginHooks.Service
    const sent: string[] = []
    const observed: Array<string | undefined> = []
    yield* aisdk.hook.sdk((event) => {
      event.sdk = createOpenAICompatible({
        ...event.options,
        name: String(event.options.name),
        baseURL: String(event.options.baseURL),
      })
    })
    const original = yield* aisdk.model({
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
    yield* hooks.register("session", "model.request", (event) =>
      Effect.sync(() => {
        observed.push(event.baseURL)
        event.baseURL = "https://replacement.example.invalid/custom/v2/"
      }),
    )
    const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
    const input = {
      session,
      agent: Agent.ID.make("build"),
      model: SessionRunnerModel.resolved(original, {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 32_000 },
      }),
      system: [],
      messages: [Message.user("hello")],
    }
    const prepared = yield* requests.primary(input)
    yield* LLMClient.generate(prepared.request, prepared.options).pipe(Effect.provide(client))

    expect(sent).toEqual(["https://replacement.example.invalid/custom/v2/chat/completions"])
    expect(observed).toEqual(["https://original.example.invalid/v1"])
  }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
)
