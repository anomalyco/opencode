import { Effect, Formatter, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, Provider, ProviderID, Tool, ToolRuntime, type ProviderModelOptions } from "@opencode-ai/llm"
import { Adapter, Auth, Endpoint, Framing, Protocol, RequestExecutor } from "@opencode-ai/llm/adapter"
import { OpenAI } from "@opencode-ai/llm/providers"

/**
 * A runnable walkthrough of the LLM package use-site API.
 *
 * Run from `packages/llm` with an OpenAI key in the environment:
 *
 *   OPENAI_API_KEY=... bun example/tutorial.ts
 *
 * The file is intentionally written as a normal TypeScript program. You can
 * hover imports and local values to see how the public API is typed.
 */

const apiKey = Bun.env.OPENAI_API_KEY
if (!apiKey) throw new Error("Set OPENAI_API_KEY to run packages/llm/example/tutorial.ts")

// 1. Pick a model. The provider helper records provider identity, protocol
// choice, capabilities, deployment options, authentication, and defaults.
const model = OpenAI.model("gpt-4o-mini", {
  apiKey,
  generation: { maxTokens: 160 },
  providerOptions: {
    openai: { store: false },
  },
})

// 2. Build a provider-neutral request. This is useful when reusing one request
// across generate and stream examples.
//
// Options can live on both the model and the request:
//
//   - `generation`: common controls such as max tokens, temperature, topP/topK,
//     penalties, seed, and stop sequences.
//   - `providerOptions`: namespaced provider-native behavior. For example,
//     OpenAI cache keys and store behavior, Anthropic thinking, Gemini thinking
//     config, or OpenRouter routing/reasoning.
//   - `http`: last-resort serializable overlays for final request body, headers,
//     and query params. Prefer typed `providerOptions` when a field is stable.
//
// Model options are defaults. Request options override them for this call.
const request = LLM.request({
  model,
  system: "You are concise and practical.",
  prompt: "Tell me a joke",
  generation: { maxTokens: 80, temperature: 0.7 },
  providerOptions: {
    openai: { promptCacheKey: "tutorial-joke" },
  },
})

// `http` is intentionally not needed for normal calls. This shows the shape for
// newly released provider fields before they deserve a typed provider option.
const rawOverlayExample = LLM.request({
  model,
  prompt: "Show the final HTTP overlay shape.",
  http: {
    body: { metadata: { example: "tutorial" } },
    headers: { "x-opencode-tutorial": "1" },
    query: { debug: "1" },
  },
})

// 3. `generate` sends the request and collects the event stream into one
// response object. `response.text` is the collected text output.
const generateOnce = Effect.gen(function* () {
  const client = yield* LLMClient.Service
  const response = yield* client.generate(request)

  console.log("\n== generate ==")
  console.log("generated text:", response.text)
  console.log("usage", Formatter.formatJson(response.usage, { space: 2 }))
})

// 4. `stream` exposes provider output as common `LLMEvent`s for UIs that want
// incremental text, reasoning, tool input, usage, or finish events.
const streamText = Effect.gen(function* () {
  const client = yield* LLMClient.Service
  return yield* client.stream(request).pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        if (event.type === "text-delta") process.stdout.write(`\ntext: ${event.text}`)
        if (event.type === "request-finish") process.stdout.write(`\nfinish: ${event.reason}\n`)
      }),
    ),
    Stream.runDrain,
  )
})

// 5. Tools are typed with Effect Schema. `ToolRuntime.Service` adds tool
// definitions to the request, dispatches matching tool calls, validates handler
// output, appends tool results to the next model round, and stops on a final
// non-tool response.
const tools = {
  get_weather: Tool.make({
    description: "Get current weather for a city.",
    parameters: Schema.Struct({ city: Schema.String }),
    success: Schema.Struct({ forecast: Schema.String }),
    execute: (input) => Effect.succeed({ forecast: `${input.city}: sunny, 72F` }),
  }),
}

const streamWithTools = Effect.gen(function* () {
  const runtime = yield* ToolRuntime.Service
  return yield* runtime
    .run({
      request: LLM.request({
        model,
        prompt: "Use get_weather for San Francisco, then answer in one sentence.",
        generation: { maxTokens: 80, temperature: 0 },
      }),
      tools,
      maxSteps: 3,
    })
    .pipe(
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event.type === "tool-call") console.log("tool call", event.name, event.input)
          if (event.type === "tool-result") console.log("tool result", event.name, event.result)
          if (event.type === "text-delta") process.stdout.write(event.text)
        }),
      ),
      Stream.runDrain,
    )
})

// -----------------------------------------------------------------------------
// Part 2: provider composition with a fake provider
// -----------------------------------------------------------------------------

// A protocol is the provider-native API shape: common request -> payload,
// response frames -> common events. This fake one turns text prompts into a JSON
// body and treats every SSE frame as output text.
const FakePayload = Schema.Struct({
  model: Schema.String,
  input: Schema.String,
})
type FakePayload = Schema.Schema.Type<typeof FakePayload>

const FakeProtocol = Protocol.define<FakePayload, string, string, void>({
  // Protocol ids are open strings, so external packages can define their own
  // protocols without changing this package.
  id: "fake-echo",
  payload: FakePayload,
  toPayload: (request) =>
    Effect.succeed({
      model: request.model.id,
      input: request.messages
        .flatMap((message) => message.content)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    }),
  chunk: Schema.String,
  initial: () => undefined,
  process: (_, frame) => Effect.succeed([undefined, [{ type: "text-delta", text: frame }]] as const),
  onHalt: () => [{ type: "request-finish", reason: "stop" }],
})

// An adapter is the runnable binding for that protocol. It adds the deployment
// axes that the protocol deliberately does not know: URL, auth, and framing.
const FakeAdapter = Adapter.make({
  id: "fake-echo",
  protocol: FakeProtocol,
  endpoint: Endpoint.baseURL({
    default: "https://fake.local",
    path: "/v1/echo",
  }),
  auth: Auth.passthrough,
  framing: Framing.sse,
})

// A provider module exports a Provider definition. The default `model` helper
// sets provider identity, protocol id, and the adapter id resolved by the registry.
const fakeEchoModel = Adapter.model(FakeAdapter, { provider: "fake-echo" })
const FakeEcho = Provider.make({
  id: ProviderID.make("fake-echo"),
  model: (id: string, options: ProviderModelOptions = {}) => fakeEchoModel({ id, ...options }),
})

// `LLMClient.prepare` is the lower-level inspection hook: it compiles through
// payload conversion, validation, endpoint, auth, and HTTP construction without
// sending anything over the network.
const inspectFakeProvider = Effect.gen(function* () {
  const client = yield* LLMClient.Service
  const prepared = yield* client.prepare(
    LLM.request({
      model: FakeEcho.model("tiny-echo"),
      prompt: "Show me the provider pipeline.",
    }),
  )

  console.log("\n== fake provider prepare ==")
  console.log("adapter:", prepared.adapter)
  console.log("payload:", Formatter.formatJson(prepared.payload, { space: 2 }))
})

// Provide the LLM runtime and the HTTP request executor once. Keep one path
// enabled at a time so the tutorial can demonstrate generate, prepare, stream,
// or tool-loop behavior without spending tokens on every example.
const requestExecutorLayer = RequestExecutor.defaultLayer
const llmClientLayer = LLMClient.layer.pipe(Layer.provide(requestExecutorLayer))

const program = Effect.gen(function* () {
  // yield* generateOnce
  // yield* inspectFakeProvider
  // yield* (yield* LLMClient.Service).prepare(rawOverlayExample).pipe(Effect.andThen((prepared) => Effect.sync(() => console.log(prepared.payload))))
  // yield* streamText
  yield* streamWithTools
}).pipe(
  Effect.provide(
    Layer.mergeAll(requestExecutorLayer, llmClientLayer, ToolRuntime.layer.pipe(Layer.provide(llmClientLayer))),
  ),
)

Effect.runPromise(program)
