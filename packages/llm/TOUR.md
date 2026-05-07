# LLM Package Tour

This is a guided walk through the parts of `@opencode-ai/llm` that are worth showing off.

The short version: the public API is small, providers are built from composable pieces, stream parsing normalizes very different APIs into one event model, and tests can run against deterministic fixtures or replayed live HTTP cassettes.

Use this as a code-reading path. Open the linked files in order and skim the referenced sections.

## Folder Structure

```text
packages/llm/
  example/                 runnable tutorial and package use-site examples
  src/                     package implementation
    schema.ts              canonical request, response, event, and error model
    llm.ts                 public constructors and runtime helpers
    route/               route composition, transport, auth, framing, protocol contracts
    protocols/             OpenAI, Anthropic, Gemini, Bedrock, and compatible protocols
    providers/             provider definitions and provider-specific routing metadata
    tool*.ts               typed tool definitions and tool-loop runtime
  test/                    deterministic fixtures, recorded cassettes, and unit coverage
  script/                  package scripts
```

## Outline

- Start with `example/tutorial.ts` to see the caller-facing API.
- Read `src/llm.ts` and `src/schema.ts` for the public runtime and canonical model.
- Follow `src/route/client.ts` to understand request preparation, transport, parsing, and collection.
- Read `src/route/protocol.ts`, `src/protocols/`, and `src/providers/` when adding or changing providers.
- Read `src/tool-runtime.ts` and the recorded tests when changing tool loops or streaming behavior.

## Tour Index

- **Use-site shape**: Sections 1-2 show the public API and canonical request model.
- **Request lifecycle**: Sections 3-4 name the main runtime pieces and follow one request through compile, HTTP, parse, and collect.
- **Provider internals**: Sections 5-8 explain protocols, route composition, provider helpers, and provider option lowering.
- **Tools and streams**: Sections 9-10 show tool-loop behavior and provider-specific parser examples.
- **Testing story**: Sections 11-13 cover deterministic fixtures, recorded cassettes, and recording commands.
- **Wrap-up paths**: Sections 14-15 summarize the design payoff and suggest shorter reading paths for demos.

Use the tour this way:

- Read Section 4 for the core request lifecycle.
- Read Sections 5-8 when adding a provider.
- Read Sections 10-13 when changing parser behavior.

## 1. Start With The Use Site

Start with the runnable tutorial: [`example/tutorial.ts`](./example/tutorial.ts).

It shows the package from the caller's point of view:

- Pick a provider model.
- Build a provider-neutral request.
- Set model defaults and call overrides with `generation`, `providerOptions`, and `http`.
- Collect a response with `LLM.generate`.
- Stream normalized `LLMEvent`s with `LLM.stream`.
- Define typed tools with Effect Schema.
- Build a fake provider from protocol pieces.

The public shape is intentionally boring:

```ts
const model = OpenAI.model("gpt-4o-mini", {
  apiKey,
  providerOptions: { openai: { store: false } },
})

const response = yield * LLM.generate({
  model,
  prompt: "Say hello.",
  generation: { maxTokens: 80, temperature: 0 },
})
```

The interesting part is that the boring use site can route through OpenAI Responses, OpenAI Chat, Anthropic Messages, Gemini, Bedrock Converse, OpenRouter, Azure, or an arbitrary OpenAI-compatible server without changing the caller's mental model.

## 2. The Public Runtime Is Small

The public `LLM` namespace lives in [`src/llm.ts`](./src/llm.ts).

Read these pieces first:

- `LLM.make` builds the default model-bound runtime.
- `LLM.layer` provides that runtime as an Effect service.
- `LLM.generate` and `LLM.stream` are thin service calls.
- `LLM.request` turns ergonomic input into canonical schema classes.
- `LLM.stream({ request, tools })` can expose and execute typed tools.

The canonical data model is in [`src/schema.ts`](./src/schema.ts). That file defines the runtime shapes that every provider lowers from or emits back to: `ModelRef`, `LLMRequest`, `Message`, `ContentPart`, `LLMEvent`, `Usage`, and the typed error classes.

The key design choice is that the public request model stays provider-neutral. Common controls live in `generation`, provider-native controls live in `providerOptions.<provider>`, and raw serializable HTTP patches live in `http`. Provider-specific wire bodies are not represented in `LLMRequest`; they live in protocol-local payload schemas.

## 3. Name The Big Pieces

Before following one request through the runtime, name the main concepts:

- `LLMRequest`: the canonical provider-neutral request. This is what callers build and what protocols read.
- `ModelRef`: the selected model plus routing metadata. `model.route` chooses the runnable route route; `route.protocol` records the wire protocol semantics.
- `generation`: provider-neutral call controls. Model values are defaults; request values override them.
- `providerOptions`: namespaced provider-native knobs. Model values are defaults; request values override by provider namespace.
- `http`: last-resort serializable overlays for final body, headers, and query params.
- `Protocol`: the wire-format brain. It converts `LLMRequest` into a provider-native payload and parses provider-native stream chunks back into `LLMEvent`s.
- `Route`: the runnable deployment. It combines one `Protocol` with an `Endpoint`, `Auth`, `Framing`, and headers.
- `RequestExecutor`: the transport boundary. It sends an `HttpClientRequest` and returns an `HttpClientResponse`.
- `LLMEvent`: the normalized stream output. Every provider eventually emits the same event vocabulary.

The most important distinction is route route versus protocol implementation:

```ts
const model: ModelRef = OpenAICompatible.deepseek.model("deepseek-chat")

model.route // "openai-compatible-chat" — which runnable route to use
route.protocol // "openai-chat"            — which wire protocol it speaks
```

Most routes have the same value for both fields. OpenAI-compatible Chat is the useful exception: it routes through the generic compatible route while reusing the OpenAI Chat wire protocol.

## 4. Follow One Request Through The Pipeline

The runtime pipeline is concentrated in [`src/route/client.ts`](./src/route/client.ts).

The important functions are:

- `Route.model`, which binds a provider model factory to the route that can run it.
- `LLMClient`, which selects a registered route, builds the payload, sends HTTP, and parses the response.
- `Route.make`, which composes protocol semantics with endpoint, auth, and framing.

At runtime, the flow is easier to read as a sequence of values. There are two levels to keep separate:

- The main request path: caller input becomes a provider HTTP request, then normalized events.
- The parser zoom-in: `route.parse(...)` hides response framing, chunk decoding, and stream state.

```text
RequestInput
  -> LLMRequest
  -> provider Payload
  -> HttpClientRequest
  -> HttpClientResponse
  -> Stream<LLMEvent>
  -> LLMResponse

Zoom into route.parse(...):

HttpClientResponse.stream
  -> Framing
  -> Frame
  -> protocol.chunk
  -> Chunk
  -> protocol.process(State, Chunk)
  -> LLMEvent[]
  -> Stream<LLMEvent>
```

The snippet below is pseudo-code. It shows resolved values at each boundary, not the `Effect` wrappers used by the implementation.

```ts
type Payload = OpenAIChatPayload

// -----------------------------------------------------------------------------
// Stage 1: Caller Forms A Canonical Request
// -----------------------------------------------------------------------------

// Use-site input can be ergonomic `RequestInput`...
const input: RequestInput = {
  model: OpenAI.model("gpt-4o-mini", {
    apiKey,
    generation: { maxTokens: 160 },
    providerOptions: { openai: { store: false } },
  }),
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 80, temperature: 0 },
  providerOptions: { openai: { promptCacheKey: "tour" } },
}

// RequestInput -> LLMRequest
// This canonicalizes the ergonomic caller shape into the common runtime schema.
const request: LLMRequest = LLM.request(input)

// -----------------------------------------------------------------------------
// Stage 2: Caller Hands The Request To The Client
// -----------------------------------------------------------------------------

// The caller hands that request to the client and chooses one exit path:
// inspect the compiled request, stream events, or collect a final response.
// Alternative A: compile without sending HTTP. Useful for request-shape tests.
// LLMRequest -> PreparedRequestOf<Payload>
const prepared: PreparedRequestOf<Payload> = LLMClient.prepare<Payload>(request)

// Alternative B: send HTTP and expose normalized stream events.
// LLMRequest -> Stream<LLMEvent>
const streamed: Stream.Stream<LLMEvent, LLMError> = LLMClient.stream(request)

// Alternative C: send HTTP and collect those same events into one response.
// LLMRequest -> LLMResponse
const generated: LLMResponse = LLMClient.generate(request)

// -----------------------------------------------------------------------------
// Stage 3: Client Compiles The Request
// -----------------------------------------------------------------------------

// Internally, all three alternatives start by compiling the request. The client
// first resolves model defaults plus request overrides, then selects the
// runnable route from the registry keyed by `request.model.route`.
const resolvedRequest: LLMRequest = resolveModelAndCallOptions(request)
const route: Route<Payload> = resolveAdapter(request.model)

// Route.toPayload is the protocol conversion boundary.
// LLMRequest -> provider-native Payload
// It builds the JSON body shape for this API family, but does not choose a URL,
// add auth, encode JSON, or send HTTP.
// OpenAI Chat example output:
const draftPayload: Payload = route.toPayload(resolvedRequest)
// {
//   model: "gpt-4o-mini",
//   messages: [
//     { role: "system", content: "You are concise." },
//     { role: "user", content: "Say hello." },
//   ],
//   stream: true,
//   stream_options: { include_usage: true },
//   max_tokens: 80,
//   temperature: 0,
//   store: false,
//   prompt_cache_key: "tour",
// }

// The candidate payload is validated against the protocol schema before HTTP
// construction.
const payload: Payload = validatePayload(draftPayload, route.payloadSchema)

// Route.make composes Endpoint + Auth + JSON body encoding into a real request.
// Payload + HttpContext -> HttpClientRequest
const httpRequest: HttpClientRequest.HttpClientRequest = route.toHttp(payload, {
  request: resolvedRequest,
})

// -----------------------------------------------------------------------------
// Stage 4: Client Executes HTTP
// -----------------------------------------------------------------------------

// RequestExecutor is the transport boundary.
// HttpClientRequest -> HttpClientResponse
const httpResponse: HttpClientResponse.HttpClientResponse = RequestExecutor.execute(httpRequest)

// -----------------------------------------------------------------------------
// Stage 5: Route Parses The Provider Stream
// -----------------------------------------------------------------------------

// Public route parsing exposes only normalized events.
// HttpClientResponse -> Stream<LLMEvent>
const events: Stream.Stream<LLMEvent, LLMError> = route.parse(httpResponse, {
  request: payloadStep.request,
})

// ◆ Zoom in: what Route.parse hides ◆
// Route.make builds `parse` from Framing + protocol chunk decoding +
// Protocol.process. Those pieces have their own concrete types:
type Frame = string // One transport-framed item, before provider Schema decoding.
type Chunk = OpenAIChatChunk // One provider-native stream object, after Schema decoding.
type State = OpenAIChatStreamState // Parser memory needed across streamed chunks.

const protocol: Protocol<Payload, Frame, Chunk, State> = OpenAIChat.protocol
const framing: Framing<Frame> = Framing.sse

// Framing is the transport-to-protocol boundary. It splits raw response bytes
// into frames: the smallest complete response units the transport can deliver.
// For SSE, one frame is usually one `data:` string. For Bedrock, one frame is
// one AWS event-stream message object. A frame is not trusted provider data yet.
// Stream<Uint8Array> -> Stream<Frame>
const frames: Stream.Stream<Frame, ProviderChunkError> = framing.frame(httpResponse.stream)

// The chunk Schema turns one frame into one typed provider chunk. This is where
// transport output becomes provider-native data: OpenAIChatChunk,
// AnthropicMessagesChunk, GeminiChunk, and so on.
// Frame -> Chunk
const decodeChunk: (frame: Frame) => Effect.Effect<Chunk, ProviderChunkError> = (frame) =>
  Schema.decodeUnknownEffect(protocol.chunk)(frame).pipe(Effect.mapError(() => chunkError(route.id, frame)))

const chunks: Stream.Stream<Chunk, ProviderChunkError> = frames.pipe(Stream.mapEffect(decodeChunk))

// Protocol.process is where provider events become LLMEvents.
// Example: OpenAI may stream one tool call over several chunks; `State` holds
// the partial argument JSON until the final chunk emits one `tool-call` event.
// State + Chunk -> State + ReadonlyArray<LLMEvent>
const initialState: State = protocol.initial()
const eventBatches: Stream.Stream<ReadonlyArray<LLMEvent>, ProviderChunkError> = chunks.pipe(
  Stream.mapAccumEffect(initialState, protocol.process),
)

// This flattened stream is what `route.parse(...)` exposes as `events`.
// Stream<ReadonlyArray<LLMEvent>> -> Stream<LLMEvent>
const eventsFromInternals: Stream.Stream<LLMEvent, LLMError> = eventBatches.pipe(Stream.flatMap(Stream.fromIterable))

// ◇ Zoom out: back to the client lifecycle ◇
// From here on, the client no longer cares about frames, chunks, or parser
// state. It only has the normalized event stream returned by `route.parse(...)`.

// -----------------------------------------------------------------------------
// Stage 6: Client Exposes Or Collects Events
// -----------------------------------------------------------------------------

// LLM.stream exposes `events` directly.
// LLM.generate collects those same events into one LLMResponse.
// Stream<LLMEvent> -> LLMResponse
const collected: { readonly events: ReadonlyArray<LLMEvent>; readonly usage?: Usage } = collectEvents(events)
const response: LLMResponse = new LLMResponse(collected)
```

The useful lower-level seam is `LLMClient.prepare`: it compiles the entire provider request without sending it. That makes request-shape tests cheap and makes demos easy because you can show exactly what would be sent. It is intentionally not part of the top-level `LLM` convenience API.

See examples in [`test/provider/openai-chat.test.ts`](./test/provider/openai-chat.test.ts) and [`test/provider/openai-responses.test.ts`](./test/provider/openai-responses.test.ts).

## 5. Protocols Are The Provider-Native Semantics

The protocol abstraction is defined in [`src/route/protocol.ts`](./src/route/protocol.ts).

A protocol owns the parts that are intrinsic to an API family:

- `payload`: Effect Schema for the provider-native JSON request body.
- `toPayload`: convert common `LLMRequest` into that provider payload.
- `chunk`: Effect Schema for one framed response item.
- `initial`: initial parser state for a response stream.
- `process`: chunk-by-chunk state machine that emits common `LLMEvent`s.
- `onHalt`: optional final flush when the stream ends.

The type shape is deliberately four-part: request payload, framed response item, decoded chunk, and parser state.

```ts
interface Protocol<Payload, Frame, Chunk, State> {
  readonly id: ProtocolID
  readonly payload: Schema.Codec<Payload, unknown>
  readonly toPayload: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  readonly chunk: Schema.Codec<Chunk, Frame>
  readonly initial: () => State
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], ProviderChunkError>
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>
}
```

Read those generics as the same parser zoom-in from Section 4:

- `Payload`: the provider-native JSON body after request conversion and validation.
- `Frame`: one response unit after byte framing, such as an SSE `data:` string or a Bedrock event-stream object.
- `Chunk`: the provider-native stream chunk after Schema decoding one frame.
- `State`: the accumulator needed to turn a sequence of chunks into common events.

The main protocol implementations are:

- OpenAI Chat Completions: [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts)
- OpenAI Responses: [`src/protocols/openai-responses.ts`](./src/protocols/openai-responses.ts)
- Anthropic Messages: [`src/protocols/anthropic-messages.ts`](./src/protocols/anthropic-messages.ts)
- Gemini GenerateContent: [`src/protocols/gemini.ts`](./src/protocols/gemini.ts)
- Bedrock Converse: [`src/protocols/bedrock-converse.ts`](./src/protocols/bedrock-converse.ts)

The protocol files are sectioned the same way:

```ts
Public Model Input
Request Payload Schema
Request To Payload
Stream Parsing
Protocol And Route
Model Helper
```

That layout keeps the same story in each file: wire payload, request lowering, stream parsing, and route assembly.

## 6. Route Composition Is Where The Reuse Shows Up

The route composition rule is:

```ts
Route = Protocol + Endpoint + Auth + Framing
```

```text
                 +-------------------+
                 |      Protocol     |  request lowering + stream parsing
                 +-------------------+
                           |
+----------+     +---------v---------+     +------+     +---------+
| Endpoint | --> |      Route      | <-- | Auth | <-- | Framing |
+----------+     +-------------------+     +------+     +---------+
     URL              runnable route        headers      bytes -> frames
```

The pieces live in these files:

- Protocol contract: [`src/route/protocol.ts`](./src/route/protocol.ts)
- Route constructor: [`src/route/client.ts`](./src/route/client.ts)
- Endpoint rendering: [`src/route/endpoint.ts`](./src/route/endpoint.ts)
- Auth strategies: [`src/route/auth.ts`](./src/route/auth.ts)
- Stream framing: [`src/route/framing.ts`](./src/route/framing.ts)

The runnable route erases the response internals after composition. Callers only need a payload type plus a normalized parser:

```ts
interface Route<Payload> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly payloadSchema: Schema.Codec<Payload, unknown>
  readonly toPayload: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  readonly toHttp: (
    payload: Payload,
    context: HttpContext,
  ) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (
    response: HttpClientResponse.HttpClientResponse,
    context: HttpContext,
  ) => Stream.Stream<LLMEvent, LLMError>
}
```

`id` is the route route used for model lookup. `protocol` is the wire protocol implementation id. Most routes use matching values, but OpenAI-compatible Chat is intentionally different: the route route is `openai-compatible-chat`, while the reused wire protocol is `openai-chat`.

`Endpoint` receives both the canonical request and the validated provider payload, so dynamic paths can read either side:

```ts
interface EndpointInput<Payload> {
  readonly request: LLMRequest
  readonly payload: Payload
}

type EndpointPart<Payload> = string | ((input: EndpointInput<Payload>) => string)

interface Endpoint<Payload> {
  readonly baseURL?: EndpointPart<Payload>
  readonly path: EndpointPart<Payload>
  readonly required?: string
}
```

`Auth` is a per-request header function. It can be a simple API-key merge or a full body-signing strategy:

```ts
type Auth = (input: AuthInput) => Effect.Effect<Record<string, string>, LLMError>

interface AuthInput {
  readonly request: LLMRequest
  readonly method: "POST" | "GET"
  readonly url: string
  readonly body: string
  readonly headers: Record<string, string>
}
```

`Framing` is the transport-to-protocol seam. It does not know about JSON payload schemas or common events:

```ts
interface Framing<Frame> {
  readonly id: string
  readonly frame: (bytes: Stream.Stream<Uint8Array, ProviderChunkError>) => Stream.Stream<Frame, ProviderChunkError>
}
```

OpenAI Chat is the base case. It defines a full protocol and route in [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts).

OpenAI-compatible Chat is the code-reuse showcase in [`src/protocols/openai-compatible-chat.ts`](./src/protocols/openai-compatible-chat.ts):

```ts
export const route = Route.make({
  id: "openai-compatible-chat",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})
```

That route reuses `OpenAIChat.protocol` end-to-end. It changes the deployment axes: route route id, endpoint, and provider identity.

The payoff is that providers like DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks, DeepInfra, Groq, and OpenRouter can share the same Chat protocol instead of copying a 300-line route.

Provider family wiring lives here:

- Generic OpenAI-compatible provider helper: [`src/providers/openai-compatible.ts`](./src/providers/openai-compatible.ts)
- Provider profiles and capabilities: [`src/providers/openai-compatible-profile.ts`](./src/providers/openai-compatible-profile.ts)
- OpenRouter wrapper with provider-specific options: [`src/providers/openrouter.ts`](./src/providers/openrouter.ts)

## 7. Provider Definitions Keep Call Sites Boring

The provider modules exported from [`src/providers/index.ts`](./src/providers/index.ts) are thin use-site APIs built around [`Provider.make`](./src/provider.ts).

`Provider.make(...)` is the public contract for provider packages:

```ts
export const provider = Provider.make({
  id: ProviderID.make("openai"),
  model: responses,
  apis: { responses, chat },
})

export const model = provider.model
export const apis = provider.apis
```

The shape is intentionally small:

- `id`: branded provider id used for routing and option namespaces.
- `model`: default model factory, usually the provider's recommended API.
- `apis`: optional named API-specific factories, for providers where one model id can route through different native APIs.

Built-in providers export namespace modules such as `OpenAI`, `Azure`, and `OpenRouter`. Those modules expose `provider` plus ergonomic aliases like `model`, `chat`, `responses`, or `apis` so internal call sites stay direct. External provider packages should make their default export the `Provider.make(...)` result and may also export named aliases for convenience.

Examples:

- `OpenAI.model` defaults to Responses, while `OpenAI.apis.chat` and `OpenAI.chat` construct a Chat model in [`src/providers/openai.ts`](./src/providers/openai.ts).
- `Anthropic.model` constructs a Messages model in [`src/providers/anthropic.ts`](./src/providers/anthropic.ts).
- `Google.model` constructs a Gemini model in [`src/providers/google.ts`](./src/providers/google.ts).
- `AmazonBedrock.model` constructs a Bedrock Converse model with credentials in [`src/providers/amazon-bedrock.ts`](./src/providers/amazon-bedrock.ts).
- `OpenAICompatible.deepseek.model` constructs a named OpenAI-compatible deployment model in [`src/providers/openai-compatible.ts`](./src/providers/openai-compatible.ts).
- `OpenRouter.model` constructs an OpenAI-compatible Chat model with OpenRouter options in [`src/providers/openrouter.ts`](./src/providers/openrouter.ts).

Provider definitions should usually not contain stream parsing, JSON decoding, or protocol details. They set provider identity, defaults, capabilities, deployment options, auth defaults, and model-bound routes. Keep lower-level route arrays as separate advanced exports; they are implementation details, not fields on `Provider.make(...)`.

## 8. Provider Options Lower In Providers Or Protocols

Provider-specific knobs should live at the closest concrete owner:

- Provider facades attach typed defaults to `ModelRef.providerOptions`, `ModelRef.generation`, and `ModelRef.http`.
- Calls can pass the same option shape on `LLM.request(...)` or directly to `LLM.generate(...)` / `LLM.stream(...)`.
- The client resolves model defaults plus request overrides before protocol lowering. Later request values win.
- Protocols lower `generation` and their own provider namespace into provider-native payload fields.
- Thin provider wrappers, such as OpenRouter, can extend a reused protocol payload when the provider has extra native fields.

The public split is:

```ts
LLM.request({
  model,
  prompt: "Think briefly.",
  generation: {
    maxTokens: 1024,
    temperature: 0,
    topP: 0.9,
  },
  providerOptions: {
    openai: { reasoningEffort: "high" },
    anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
    gemini: { thinkingConfig: { thinkingBudget: 4096, includeThoughts: true } },
    openrouter: { reasoning: { effort: "high" } },
  },
  http: {
    body: { raw_provider_field: true },
    headers: { "x-provider-experiment": "1" },
    query: { debug: "1" },
  },
})
```

Use `http` only as a serializable escape hatch. If a field is stable and provider-owned, promote it into `providerOptions.<provider>`.

Do not grow common request schemas just to fit one provider. Prefer `generation` for genuinely common sampling/output controls, typed `providerOptions` for provider behavior, and protocol/provider-local lowering for native wire details.

## 9. Tools Are Typed End To End

The public tutorial shows typed tools in [`example/tutorial.ts`](./example/tutorial.ts). The implementation is in [`src/tool.ts`](./src/tool.ts) and [`src/tool-runtime.ts`](./src/tool-runtime.ts).

What is worth showing:

- Tool definitions use Effect Schema for inputs and success values: [`src/tool.ts`](./src/tool.ts)
- Tool runtime streams model output, dispatches tool calls, validates results, and loops: [`src/tool-runtime.ts`](./src/tool-runtime.ts)
- Unknown tools, invalid input, and handler failures become model-visible tool errors: [`test/tool-runtime.test.ts`](./test/tool-runtime.test.ts)
- Provider-executed tools pass through without client dispatch: [`src/tool-runtime.ts`](./src/tool-runtime.ts)

The common event model is what makes this work across providers. Providers emit `tool-input-delta`, `tool-call`, `tool-result`, and `request-finish` events; the runtime consumes those events and decides whether another model round is needed.

Streamed tool-call assembly is shared by [`src/protocols/utils/tool-stream.ts`](./src/protocols/utils/tool-stream.ts). Protocols still own provider-native chunk interpretation, finish reason mapping, and usage mapping; the helper only starts pending tool calls, appends argument JSON deltas, emits `tool-input-delta`, and finalizes parsed `tool-call` events.

## 10. Stream Parser Examples

Examples worth reading:

- [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts) accumulates streamed tool JSON by numeric index and finalizes tool calls at `finish_reason`.
- [`src/protocols/openai-responses.ts`](./src/protocols/openai-responses.ts) handles item lifecycle events and hosted provider-executed tool items.
- [`src/protocols/anthropic-messages.ts`](./src/protocols/anthropic-messages.ts) merges usage from `message_start` and `message_delta`, and supports server tools.
- [`src/protocols/gemini.ts`](./src/protocols/gemini.ts) converts Gemini parts into text, reasoning, and tool-call events.
- [`src/protocols/bedrock-converse.ts`](./src/protocols/bedrock-converse.ts) parses AWS event-stream frames and waits for metadata to emit finish with usage.

This is where provider APIs differ the most, behind the same normalized `LLMEvent` stream.

## 11. Deterministic Tests Cover The Parser Edge Cases

Before live recordings, the package uses deterministic in-memory HTTP layers.

Start with [`test/lib/http.ts`](./test/lib/http.ts):

- `fixedResponse` returns one deterministic provider response body.
- `dynamicResponse` inspects the outgoing request and builds a response.
- `truncatedStream` simulates mid-stream transport failure.
- `scriptedResponses` drives multi-round tool loops with a sequence of responses.

SSE helpers live in [`test/lib/sse.ts`](./test/lib/sse.ts). OpenAI chunk helpers live in [`test/lib/openai-chunks.ts`](./test/lib/openai-chunks.ts).

Good tests to read:

- [`test/provider/openai-chat.test.ts`](./test/provider/openai-chat.test.ts) covers request payloads, stream text, usage, tool-call streaming, malformed chunks, and HTTP errors.
- [`test/provider/openai-responses.test.ts`](./test/provider/openai-responses.test.ts) covers Responses item lifecycle, hosted tools, and provider errors.
- [`test/provider/anthropic-messages.test.ts`](./test/provider/anthropic-messages.test.ts) covers message blocks, reasoning, server tools, and usage merging.
- [`test/provider/gemini.test.ts`](./test/provider/gemini.test.ts) covers media input, schema conversion, reasoning, and finish reasons.
- [`test/provider/bedrock-converse.test.ts`](./test/provider/bedrock-converse.test.ts) covers binary event stream decoding, SigV4 auth boundaries, and Bedrock tool deltas.
- [`test/tool-runtime.test.ts`](./test/tool-runtime.test.ts) covers tool loop behavior without live model calls.

These tests are fast because they never call a provider. They validate request bodies and parser behavior directly.

## 12. The Cassette Recorder Is The Testing Story

Recorded tests are the coolest part of the safety net.

The wrapper is [`test/recorded-test.ts`](./test/recorded-test.ts). It builds on `@opencode-ai/http-recorder` and gives each live test a cassette name, metadata, filters, and credential gates.

Recorded test files:

- OpenAI Chat basic and tool flows: [`test/provider/openai-chat.recorded.test.ts`](./test/provider/openai-chat.recorded.test.ts)
- OpenAI Chat full tool loop: [`test/provider/openai-chat-tool-loop.recorded.test.ts`](./test/provider/openai-chat-tool-loop.recorded.test.ts)
- OpenAI Responses: [`test/provider/openai-responses.recorded.test.ts`](./test/provider/openai-responses.recorded.test.ts)
- Anthropic Messages: [`test/provider/anthropic-messages.recorded.test.ts`](./test/provider/anthropic-messages.recorded.test.ts)
- Gemini: [`test/provider/gemini.recorded.test.ts`](./test/provider/gemini.recorded.test.ts)
- OpenAI-compatible families: [`test/provider/openai-compatible-chat.recorded.test.ts`](./test/provider/openai-compatible-chat.recorded.test.ts)
- Bedrock Converse recorded cases: [`test/provider/bedrock-converse.test.ts`](./test/provider/bedrock-converse.test.ts)

The shared recorded scenarios are in [`test/recorded-scenarios.ts`](./test/recorded-scenarios.ts). That file keeps live tests semantically comparable across providers: text generation, tool calls, tool loops, event summaries, and usage assertions.

Cassettes live under [`test/fixtures/recordings`](./test/fixtures/recordings). They record HTTP request/response pairs, not just expected events, so replay exercises the real provider parser against captured wire data.

## 13. How To Run Recordings

Replay is the default. Missing cassettes are skipped unless you explicitly record.

Common commands from `packages/llm`:

```sh
bun run test
bun run test test/provider/openai-chat.test.ts
bun run test test/provider/openai-chat.recorded.test.ts
RECORDED_PROVIDER=openai bun run test
RECORDED_PREFIX=openai-chat bun run test
RECORDED_TEST="streams text" bun run test
```

Record intentionally:

```sh
RECORD=true OPENAI_API_KEY=... bun run test test/provider/openai-chat.recorded.test.ts
```

Recorded filters are implemented in [`test/recorded-test.ts`](./test/recorded-test.ts):

- `RECORDED_PREFIX` matches cassette groups such as `openai-chat`.
- `RECORDED_PROVIDER` matches metadata tags such as `provider:openai`.
- `RECORDED_TAGS` requires tags such as `tool` or `provider:togetherai`.
- `RECORDED_TEST` matches by test name, kebab id, or cassette path.

The setup script is [`script/setup-recording-env.ts`](./script/setup-recording-env.ts). It helps populate `.env.local`, checks which provider credentials are present, and can verify recommended recording providers.

The cost report script is [`script/recording-cost-report.ts`](./script/recording-cost-report.ts). It walks cassette files, extracts usage from provider response bodies, looks up pricing from `models.dev`, and prints estimated recording costs.

## 14. Why This Design Is Nice

The package gets several useful properties from this shape:

- Simple use site from `LLM.generate`, provider model helpers, and `LLM.request` constructors.
- Provider code reuse from separating `Protocol`, `Endpoint`, `Auth`, and `Framing`.
- Native wire visibility because payload and chunk schemas stay close to lowering/parsing code.
- Safe provider quirks because provider-specific payload fields stay in provider/protocol code instead of the common request schema.
- Common UI/runtime events because every provider parser emits `LLMEvent`s.
- Tool-loop portability because tool orchestration consumes common tool events instead of provider-specific streams.
- Fast parser tests from `fixedResponse`, `dynamicResponse`, and `scriptedResponses`.
- Real integration confidence because HTTP cassettes replay actual provider wire data.

## 15. Suggested Reading Paths

For a user-facing demo:

1. Open [`example/tutorial.ts`](./example/tutorial.ts).
2. Run `OPENAI_API_KEY=... bun example/tutorial.ts` from `packages/llm`.
3. Skim [`src/llm.ts`](./src/llm.ts) to see how little the public API does.
4. Open [`test/provider/openai-chat.test.ts`](./test/provider/openai-chat.test.ts) to show deterministic parser tests.
5. Open [`test/provider/openai-chat.recorded.test.ts`](./test/provider/openai-chat.recorded.test.ts) to show live cassettes.

For a provider-composition demo:

1. Open [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts).
2. Open [`src/protocols/openai-compatible-chat.ts`](./src/protocols/openai-compatible-chat.ts).
3. Compare `OpenAIChat.protocol` reuse with a different route id and endpoint.
4. Open [`src/providers/openrouter.ts`](./src/providers/openrouter.ts) to show provider-specific options layered into a reused Chat payload.
5. Open [`src/providers/openai-compatible-profile.ts`](./src/providers/openai-compatible-profile.ts) to show family metadata and defaults.

For a testing demo:

1. Open [`test/lib/http.ts`](./test/lib/http.ts).
2. Open [`test/provider/openai-chat.test.ts`](./test/provider/openai-chat.test.ts).
3. Open [`test/recorded-test.ts`](./test/recorded-test.ts).
4. Open [`test/recorded-scenarios.ts`](./test/recorded-scenarios.ts).
5. Run `RECORDED_PROVIDER=openai bun run test` from `packages/llm`.
6. Run `bun script/recording-cost-report.ts` from `packages/llm` when cassette costs are relevant.
