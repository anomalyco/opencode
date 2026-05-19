import { Config, Effect, Formatter, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, Provider, ProviderID, Tool, type ProviderModelOptions } from "@opencode-ai/llm"
import { Route, Auth, Endpoint, Framing, Protocol, RequestExecutor } from "@opencode-ai/llm/route"
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

const apiKey = Config.redacted("OPENAI_API_KEY")

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
  const response = yield* LLM.generate(request)

  console.log("\n== generate ==")
  console.log("generated text:", response.text)
  console.log("usage", Formatter.formatJson(response.usage, { space: 2 }))
})

// 4. `stream` exposes provider output as common `LLMEvent`s for UIs that want
// incremental text, reasoning, tool input, usage, or finish events.
const streamText = LLM.stream(request).pipe(
  Stream.tap((event) =>
    Effect.sync(() => {
      if (event.type === "text-delta") process.stdout.write(`\ntext: ${event.text}`)
      if (event.type === "finish") process.stdout.write(`\nfinish: ${event.reason}\n`)
    }),
  ),
  Stream.runDrain,
)

// 5. Tools are typed with Effect Schema. Passing tools to `LLMClient.stream`
// adds their definitions to the request and dispatches matching tool calls.
// Add `stopWhen` to opt into follow-up model rounds after tool results.
const tools = {
  get_weather: Tool.make({
    description: "Get current weather for a city.",
    parameters: Schema.Struct({ city: Schema.String }),
    success: Schema.Struct({ forecast: Schema.String }),
    execute: (input) => Effect.succeed({ forecast: `${input.city}: sunny, 72F` }),
  }),
}

const streamWithTools = LLM.stream({
  request: LLM.request({
    model,
    prompt: "Use get_weather for San Francisco, then answer in one sentence.",
    generation: { maxTokens: 80, temperature: 0 },
  }),
  tools,
  stopWhen: LLM.stepCountIs(3),
}).pipe(
  Stream.tap((event) =>
    Effect.sync(() => {
      if (event.type === "tool-call") console.log("tool call", event.name, event.input)
      if (event.type === "tool-result") console.log("tool result", event.name, event.result)
      if (event.type === "text-delta") process.stdout.write(event.text)
    }),
  ),
  Stream.runDrain,
)

// 6. `generateObject` is the structured-output helper. It forces a synthetic
// tool call internally, so the same call site works across providers instead of
// depending on provider-specific JSON mode flags.
const WeatherReport = Schema.Struct({
  city: Schema.String,
  forecast: Schema.String,
  highFahrenheit: Schema.Number,
})

const generateStructuredObject = Effect.gen(function* () {
  const response = yield* LLM.generateObject({
    model,
    system: "Return only structured weather data.",
    prompt: "Give me today's weather for San Francisco.",
    schema: WeatherReport,
    generation: { maxTokens: 120, temperature: 0 },
  })

  console.log("\n== generateObject ==")
  console.log(Formatter.formatJson(response.object, { space: 2 }))
})

// If the shape is only known at runtime, pass raw JSON Schema instead. The
// `.object` type is `unknown`; callers that need static types should validate it.
const generateDynamicObject = LLM.generateObject({
  model,
  prompt: "Extract the city and forecast from: San Francisco is sunny.",
  jsonSchema: {
    type: "object",
    properties: {
      city: { type: "string" },
      forecast: { type: "string" },
    },
    required: ["city", "forecast"],
  },
})

// -----------------------------------------------------------------------------
// Part 2: provider composition with a fake provider
// -----------------------------------------------------------------------------

// A protocol is the provider-native API shape: common request -> body, response
// frames -> common events. This fake one turns text prompts into a JSON body
// and treats every SSE frame as output text.
const FakeBody = Schema.Struct({
  model: Schema.String,
  input: Schema.String,
})
type FakeBody = Schema.Schema.Type<typeof FakeBody>

const FakeProtocol = Protocol.make<FakeBody, string, string, void>({
  // Protocol ids are open strings, so external packages can define their own
  // protocols without changing this package.
  id: "fake-echo",
  body: {
    schema: FakeBody,
    from: (request) =>
      Effect.succeed({
        model: request.model.id,
        input: request.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      }),
  },
  stream: {
    event: Schema.String,
    initial: () => undefined,
    step: (_, frame) => Effect.succeed([undefined, [{ type: "text-delta", id: "text-0", text: frame }]] as const),
    onHalt: () => [{ type: "finish", reason: "stop" }],
  },
})

// An route is the runnable binding for that protocol. It adds the deployment
// axes that the protocol deliberately does not know: URL, auth, and framing.
const FakeAdapter = Route.make({
  id: "fake-echo",
  protocol: FakeProtocol,
  endpoint: Endpoint.path("/v1/echo"),
  auth: Auth.passthrough,
  framing: Framing.sse,
})

// A provider module exports a Provider definition. The default `model` helper
// sets provider identity, protocol id, and the route id resolved by the registry.
const fakeEchoModel = Route.model(FakeAdapter, { provider: "fake-echo", baseURL: "https://fake.local" })
const FakeEcho = Provider.make({
  id: ProviderID.make("fake-echo"),
  model: (id: string, options: ProviderModelOptions = {}) => fakeEchoModel({ id, ...options }),
})

// `LLMClient.prepare` is the lower-level inspection hook: it compiles through
// body conversion, validation, endpoint, auth, and HTTP construction without
// sending anything over the network.
const inspectFakeProvider = Effect.gen(function* () {
  const prepared = yield* LLMClient.prepare(
    LLM.request({
      model: FakeEcho.model("tiny-echo"),
      prompt: "Show me the provider pipeline.",
    }),
  )

  console.log("\n== fake provider prepare ==")
  console.log("route:", prepared.route)
  console.log("body:", Formatter.formatJson(prepared.body, { space: 2 }))
})

// Provide the LLM runtime and the HTTP request executor once. Keep one path
// enabled at a time so the tutorial can demonstrate generate, prepare, stream,
// or tool-loop behavior without spending tokens on every example.
const requestExecutorLayer = RequestExecutor.defaultLayer
const llmClientLayer = LLMClient.layer.pipe(Layer.provide(requestExecutorLayer))

const program = Effect.gen(function* () {
  // yield* generateOnce
  // yield* inspectFakeProvider
  // yield* LLMClient.prepare(rawOverlayExample).pipe(Effect.andThen((prepared) => Effect.sync(() => console.log(prepared.body))))
  // yield* streamText
  // yield* generateStructuredObject
  // yield* generateDynamicObject.pipe(Effect.andThen((response) => Effect.sync(() => console.log(response.object))))
  yield* streamWithTools
}).pipe(Effect.provide(Layer.mergeAll(requestExecutorLayer, llmClientLayer)))

Effect.runPromise(program)
