import { Effect, Formatter, Layer, Schema, Stream } from "effect"
import { Adapter, Auth, Endpoint, Framing, LLM, Protocol, RequestExecutor, Tool } from "@opencode-ai/llm"
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
// choice, capabilities, deployment options, and authentication.
const model = OpenAI.model("gpt-4o-mini", {
  apiKey,
})

// 2. Build a provider-neutral request. This is optional for one-off calls — the
// same fields can be passed directly to `LLM.generate` / `LLM.stream` — but it
// is useful when reusing one request across generate and stream examples.
const request = LLM.request({
  model,
  system: "You are concise and practical.",
  prompt: "Say hello in one short sentence.",
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
      if (event.type === "text-delta") process.stdout.write(event.text)
      if (event.type === "request-finish") process.stdout.write(`\nfinish: ${event.reason}\n`)
    }),
  ),
  Stream.runDrain,
)

// 5. Tools are typed with Effect Schema. `streamWithTools` adds tool definitions
// to the request, dispatches matching tool calls, validates handler output,
// appends tool results to the next model round, and stops on a final non-tool
// response.
const tools = {
  get_weather: Tool.make({
    description: "Get current weather for a city.",
    parameters: Schema.Struct({ city: Schema.String }),
    success: Schema.Struct({ forecast: Schema.String }),
    execute: (input) => Effect.succeed({ forecast: `${input.city}: sunny, 72F` }),
  }),
}

const streamWithTools = LLM.streamWithTools({
  model,
  prompt: "Use get_weather for San Francisco, then answer in one sentence.",
  tools,
  maxSteps: 3,
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

// -----------------------------------------------------------------------------
// Part 2: provider composition with a fake provider
// -----------------------------------------------------------------------------

// A protocol is the provider-native API shape: common request -> target body,
// response frames -> common events. This fake one turns text prompts into a JSON
// body and treats every SSE frame as output text.
const FakeTarget = Schema.Struct({
  model: Schema.String,
  input: Schema.String,
})
type FakeTarget = Schema.Schema.Type<typeof FakeTarget>

const FakeProtocol = Protocol.define<FakeTarget, string, string, void>({
  // ProtocolID is a closed union in this package. A real new provider protocol
  // would add its own id there; this tutorial reuses `openai-chat` so the fake
  // provider can compile without changing production protocol ids.
  id: "openai-chat",
  target: FakeTarget,
  prepare: (request) =>
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
const FakeAdapter = Adapter.fromProtocol({
  id: "fake-echo",
  protocol: FakeProtocol,
  endpoint: Endpoint.baseURL({
    default: "https://fake.local",
    path: "/v1/echo",
  }),
  auth: Auth.passthrough,
  framing: Framing.sse,
})

// A provider module exports adapters plus model helpers. The model helper sets
// provider identity and the protocol id used for adapter lookup.
const FakeEcho = {
  adapters: [FakeAdapter],
  model: (id: string) =>
    LLM.model({
      id,
      provider: "fake-echo",
      protocol: "openai-chat",
    }),
}

// `prepare` compiles through patches, protocol lowering, validation, endpoint,
// auth, and HTTP construction without sending anything over the network.
const inspectFakeProvider = Effect.gen(function* () {
  const prepared = yield* LLM.prepare({
    model: FakeEcho.model("tiny-echo"),
    prompt: "Show me the provider pipeline.",
  })

  console.log("\n== fake provider prepare ==")
  console.log("adapter:", prepared.adapter)
  console.log("target:", Formatter.formatJson(prepared.target, { space: 2 }))
}).pipe(Effect.provide(LLM.layer({ providers: [FakeEcho] })))

// Provide the LLM runtime and the HTTP request executor once. The default path
// sends one live generate call and one local fake-provider prepare call.
// Uncomment the alternatives when you want to inspect streaming or tool behavior
// without spending tokens on all paths.
const program = Effect.gen(function* () {
  yield* generateOnce
  yield* inspectFakeProvider
  // yield* streamText
  // yield* streamWithTools
}).pipe(Effect.provide(Layer.mergeAll(LLM.layer({ providers: [OpenAI] }), RequestExecutor.defaultLayer)))

Effect.runPromise(program)
