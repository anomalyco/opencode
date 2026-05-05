# LLM Package Tour

This is a guided walk through the parts of `@opencode-ai/llm` that are worth showing off.

The short version: the public API is small, providers are built from composable pieces, stream parsing normalizes very different APIs into one event model, and tests can run against deterministic fixtures or replayed live HTTP cassettes.

Use this as a code-reading path. Open the linked files in order and skim the referenced sections.

## Tour Index

- **Use-site shape**: Sections 1-2 show the public API and canonical request model.
- **Request lifecycle**: Sections 3-4 name the main runtime pieces and follow one request through compile, HTTP, parse, and collect.
- **Provider internals**: Sections 5-8 explain protocols, adapter composition, provider helpers, and transforms.
- **Tools and streams**: Sections 9-10 show tool-loop behavior and provider-specific parser examples.
- **Testing story**: Sections 11-13 cover deterministic fixtures, recorded cassettes, and recording commands.
- **Wrap-up paths**: Sections 14-15 summarize the design payoff and suggest shorter reading paths for demos.

## 1. Start With The Use Site

Start with the runnable tutorial: [`example/tutorial.ts`](./example/tutorial.ts).

It shows the package from the caller's point of view:

- Pick a provider model.
- Build a provider-neutral request.
- Collect a response with `LLM.generate`.
- Stream normalized `LLMEvent`s with `LLM.stream`.
- Define typed tools with Effect Schema.
- Build a fake provider from protocol pieces.

The public shape is intentionally boring:

```ts
const model = OpenAI.model("gpt-4o-mini", { apiKey })
const response = yield * LLM.generate({ model, prompt: "Say hello." })
```

The interesting part is that the boring use site can route through OpenAI Responses, OpenAI Chat, Anthropic Messages, Gemini, Bedrock Converse, OpenRouter, Azure, or an arbitrary OpenAI-compatible server without changing the caller's mental model.

## 2. The Public Runtime Is Small

The public `LLM` namespace lives in [`src/llm.ts`](./src/llm.ts).

Read these pieces first:

- `LLM.make` builds a runtime from providers, adapters, and transforms.
- `LLM.layer` provides that runtime as an Effect service.
- `LLM.generate` and `LLM.stream` are thin service calls.
- `LLM.request` turns ergonomic input into canonical schema classes.
- `LLM.streamWithTools` delegates to `ToolRuntime`.

The canonical data model is in [`src/schema.ts`](./src/schema.ts). That file defines the runtime shapes that every provider lowers from or emits back to: `ModelRef`, `LLMRequest`, `Message`, `ContentPart`, `LLMEvent`, `Usage`, and the typed error classes.

The key design choice is that the public request model is provider-neutral. Provider-specific wire bodies are not represented in `LLMRequest`; they live in protocol-local payload schemas.

## 3. Name The Big Pieces

Before following one request through the runtime, name the main concepts:

- `LLMRequest`: the canonical provider-neutral request. This is what callers build and what transforms/protocols read.
- `ModelRef`: the selected model plus routing metadata. `model.adapter` chooses the runnable adapter route; `model.protocol` records the wire protocol semantics.
- `Protocol`: the wire-format brain. It converts `LLMRequest` into a provider-native payload and parses provider-native stream chunks back into `LLMEvent`s.
- `Adapter`: the runnable deployment. It combines one `Protocol` with an `Endpoint`, `Auth`, `Framing`, headers, and adapter-local payload transforms.
- `TransformPipeline`: the rewrite layer. Runtime transforms touch only common IR; adapter-local transforms touch native payloads.
- `RequestExecutor`: the transport boundary. It sends an `HttpClientRequest` and returns an `HttpClientResponse`.
- `LLMEvent`: the normalized stream output. Every provider eventually emits the same event vocabulary.

The most important distinction is adapter route versus protocol implementation:

```ts
const model: ModelRef = OpenAICompatible.deepseek.model("deepseek-chat")

model.adapter  // "openai-compatible-chat" — which runnable adapter to use
model.protocol // "openai-chat"            — which wire protocol it speaks
```

Most adapters have the same value for both fields. OpenAI-compatible Chat is the useful exception: it routes through the generic compatible adapter while reusing the OpenAI Chat wire protocol.

## 4. Follow One Request Through The Pipeline

The runtime pipeline is concentrated in [`src/adapter.ts`](./src/adapter.ts).

The important functions are:

- `Adapter.model`, which binds a user-facing model helper to the adapter that can run it.
- `LLMClient.make`, which selects an adapter, applies transforms, builds the payload, sends HTTP, and parses the response.
- `Adapter.make`, which composes protocol semantics with endpoint, auth, and framing.

At runtime, the flow is easier to read as a sequence of value transformations. There are two levels to keep separate:

- The main request path: caller input becomes a provider HTTP request, then normalized events.
- The parser zoom-in: `adapter.parse(...)` hides response framing, chunk decoding, and stream state.

```text
RequestInput
  -> LLMRequest
  -> TransformedRequest
  -> provider Payload
  -> HttpClientRequest
  -> HttpClientResponse
  -> Stream<LLMEvent>
  -> LLMResponse

Zoom into adapter.parse(...):

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
  model: OpenAI.model("gpt-4o-mini", { apiKey }),
  system: "You are concise.",
  prompt: "Say hello.",
}

// RequestInput -> LLMRequest
// This canonicalizes the ergonomic caller shape into the common runtime schema.
const request: LLMRequest = LLM.request(input)

// -----------------------------------------------------------------------------
// Stage 2: Caller Hands The Request To The Client
// -----------------------------------------------------------------------------

// The caller hands that request to the client and chooses one exit path:
// inspect the compiled request, stream events, or collect a final response.
const client: LLMClient = LLMClient.make({ adapters: [OpenAIChat.adapter] })

// Alternative A: compile without sending HTTP. Useful for request-shape tests.
// LLMRequest -> PreparedRequestOf<Payload>
const prepared: PreparedRequestOf<Payload> = client.prepare<Payload>(request)

// Alternative B: send HTTP and expose normalized stream events.
// LLMRequest -> Stream<LLMEvent>
const streamed: Stream.Stream<LLMEvent, LLMError> = client.stream(request)

// Alternative C: send HTTP and collect those same events into one response.
// LLMRequest -> LLMResponse
const generated: LLMResponse = client.generate(request)

// -----------------------------------------------------------------------------
// Stage 3: Client Compiles The Request
// -----------------------------------------------------------------------------

// Internally, all three alternatives start by compiling the request.
// TransformPipeline is the named rewrite layer. Runtime transforms only touch
// canonical/common IR: request, prompt, tool-schema, and stream events.
const transformPipeline: TransformPipeline = TransformPipeline.make(ProviderTransform.defaults)

// The client selects the runnable adapter from the explicit registry keyed by
// `request.model.adapter`. The model-bound adapter is a fallback for models
// created directly with `Adapter.model`.
const adapter: Adapter<Payload> = resolveAdapter(request.model)

// This first pipeline call only handles pre-lowering rewrites: whole-request
// policy, prompt/message cleanup, and tool schema cleanup.
// LLMRequest -> TransformedRequest
const transformedRequest: TransformedRequest = transformPipeline.transformRequest(request)

// Adapter.toPayload is the protocol conversion boundary.
// TransformedRequest.request -> provider-native Payload
// It builds the JSON body shape for this API family, but does not choose a URL,
// add auth, encode JSON, or send HTTP.
// OpenAI Chat example output:
const draftPayload: Payload = adapter.toPayload(transformedRequest.request)
// {
//   model: "gpt-4o-mini",
//   messages: [
//     { role: "system", content: "You are concise." },
//     { role: "user", content: "Say hello." },
//   ],
//   stream: true,
// }

// Adapter-local payload transforms run after protocol lowering. They are the
// only transforms allowed to touch provider-native payloads, because the adapter
// owns the `Payload` type. The same step validates the final payload schema.
// TransformedRequest + Payload -> TransformedPayload<Payload>
const payloadStep: TransformedPayload<Payload> = transformPipeline.transformPayload({
  state: transformedRequest,
  payload: draftPayload,
  adapterTransforms: adapter.transforms,
  schema: adapter.payloadSchema,
})

const payload: Payload = payloadStep.payload

// Adapter.make composes Endpoint + Auth + JSON body encoding into a real request.
// Payload + HttpContext -> HttpClientRequest
const httpRequest: HttpClientRequest.HttpClientRequest = adapter.toHttp(payload, {
  request: payloadStep.request,
})

// -----------------------------------------------------------------------------
// Stage 4: Client Executes HTTP
// -----------------------------------------------------------------------------

// RequestExecutor is the transport boundary.
// HttpClientRequest -> HttpClientResponse
const httpResponse: HttpClientResponse.HttpClientResponse = RequestExecutor.execute(httpRequest)

// -----------------------------------------------------------------------------
// Stage 5: Adapter Parses The Provider Stream
// -----------------------------------------------------------------------------

// Public adapter parsing exposes only normalized events.
// HttpClientResponse -> Stream<LLMEvent>
const events: Stream.Stream<LLMEvent, LLMError> = adapter.parse(httpResponse, {
  request: payloadStep.request,
})

// ◆ Zoom in: what Adapter.parse hides ◆
// Adapter.make builds `parse` from Framing + protocol chunk decoding +
// Protocol.process. Those pieces have their own concrete types:
type Frame = string                // One transport-framed item, before provider Schema decoding.
type Chunk = OpenAIChatChunk        // One provider-native stream object, after Schema decoding.
type State = OpenAIChatStreamState  // Parser memory needed across streamed chunks.

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
  Schema.decodeUnknownEffect(protocol.chunk)(frame).pipe(Effect.mapError(() => chunkError(adapter.id, frame)))

const chunks: Stream.Stream<Chunk, ProviderChunkError> = frames.pipe(Stream.mapEffect(decodeChunk))

// Protocol.process is where provider events become LLMEvents.
// Example: OpenAI may stream one tool call over several chunks; `State` holds
// the partial argument JSON until the final chunk emits one `tool-call` event.
// State + Chunk -> State + ReadonlyArray<LLMEvent>
const initialState: State = protocol.initial()
const eventBatches: Stream.Stream<ReadonlyArray<LLMEvent>, ProviderChunkError> = chunks.pipe(
  Stream.mapAccumEffect(initialState, protocol.process),
)

// This flattened stream is what `adapter.parse(...)` exposes as `events`.
// Stream<ReadonlyArray<LLMEvent>> -> Stream<LLMEvent>
const eventsFromInternals: Stream.Stream<LLMEvent, LLMError> = eventBatches.pipe(Stream.flatMap(Stream.fromIterable))

// ◇ Zoom out: back to the client lifecycle ◇
// From here on, the client no longer cares about frames, chunks, or parser
// state. It only has the normalized event stream returned by `adapter.parse(...)`.

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

The protocol abstraction is defined in [`src/protocol.ts`](./src/protocol.ts).

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

- `Payload`: the provider-native JSON body after request conversion and adapter-local payload transforms.
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
Protocol And Adapter
Model Helper
```

That layout keeps the same story in each file: wire payload, request lowering, stream parsing, and adapter assembly.

## 6. Adapter Composition Is Where The Reuse Shows Up

The adapter composition rule is:

```ts
Adapter = Protocol + Endpoint + Auth + Framing
```

```text
                 +-------------------+
                 |      Protocol     |  request lowering + stream parsing
                 +-------------------+
                           |
+----------+     +---------v---------+     +------+     +---------+
| Endpoint | --> |      Adapter      | <-- | Auth | <-- | Framing |
+----------+     +-------------------+     +------+     +---------+
     URL              runnable route        headers      bytes -> frames
```

The pieces live in these files:

- Protocol contract: [`src/protocol.ts`](./src/protocol.ts)
- Adapter constructor: [`src/adapter.ts`](./src/adapter.ts)
- Endpoint rendering: [`src/endpoint.ts`](./src/endpoint.ts)
- Auth strategies: [`src/auth.ts`](./src/auth.ts)
- Stream framing: [`src/framing.ts`](./src/framing.ts)

The runnable adapter erases the response internals after composition. Callers only need a payload type plus a normalized parser:

```ts
interface Adapter<Payload> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly payloadSchema: Schema.Codec<Payload, unknown>
  readonly transforms: ReadonlyArray<Transform<Payload, "payload">>
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

`id` is the adapter route used for model lookup. `protocol` is the wire protocol implementation id. Most adapters use matching values, but OpenAI-compatible Chat is intentionally different: the adapter route is `openai-compatible-chat`, while the reused wire protocol is `openai-chat`.

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

OpenAI Chat is the base case. It defines a full protocol and adapter in [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts).

OpenAI-compatible Chat is the code-reuse showcase in [`src/protocols/openai-compatible-chat.ts`](./src/protocols/openai-compatible-chat.ts):

```ts
export const adapter = Adapter.make({
  id: "openai-compatible-chat",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})
```

That adapter reuses `OpenAIChat.protocol` end-to-end. It changes the deployment axes: adapter route id, endpoint, and provider identity.

The payoff is that providers like DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks, DeepInfra, Groq, xAI, and OpenRouter can share the same Chat protocol instead of copying a 300-line adapter.

Provider family wiring lives here:

- Generic OpenAI-compatible provider helper: [`src/providers/openai-compatible.ts`](./src/providers/openai-compatible.ts)
- Provider profiles and capabilities: [`src/providers/openai-compatible-profile.ts`](./src/providers/openai-compatible-profile.ts)
- OpenRouter wrapper with provider-specific options: [`src/providers/openrouter.ts`](./src/providers/openrouter.ts)

## 7. Provider Helpers Keep Call Sites Boring

The provider modules exported from [`src/providers.ts`](./src/providers.ts) are thin use-site APIs.

Examples:

- `OpenAI.model` defaults to Responses, and `OpenAI.chat` constructs a Chat model in [`src/providers/openai.ts`](./src/providers/openai.ts).
- `Anthropic.model` constructs a Messages model in [`src/providers/anthropic.ts`](./src/providers/anthropic.ts).
- `Google.model` constructs a Gemini model in [`src/providers/google.ts`](./src/providers/google.ts).
- `AmazonBedrock.model` constructs a Bedrock Converse model with credentials in [`src/providers/amazon-bedrock.ts`](./src/providers/amazon-bedrock.ts).
- `OpenAICompatible.deepseek.model` constructs a named OpenAI-compatible deployment model in [`src/providers/openai-compatible.ts`](./src/providers/openai-compatible.ts).
- `OpenRouter.model` constructs an OpenAI-compatible Chat model with OpenRouter options in [`src/providers/openrouter.ts`](./src/providers/openrouter.ts).

Provider helpers should usually not contain stream parsing, JSON decoding, or protocol details. They set provider identity, defaults, capabilities, deployment options, and adapter registrations.

## 8. Transforms Keep Provider Quirks Out Of Common Schemas

The transform system keeps one-off provider/model quirks from leaking into `LLMRequest`.

This is not a substitute for putting the right behavior in a protocol. If Anthropic Messages always lowers a common feature the same way, that belongs in `anthropic-messages.ts`. A transform is for behavior that is conditional on provider, model, deployment, or caller policy: the same protocol shape is mostly right, but one route needs a small, inspectable rewrite.

That is why the pipeline exists. OpenCode already had a provider-transform layer because real providers reject or require little differences that are not worth baking into the common request model. The package keeps that idea, but makes each tweak named, phase-scoped, typed, ordered, and predicate-gated.

Start here:

- Transform types and constructors: [`src/transform.ts`](./src/transform.ts)
- Transform execution pipeline: [`src/transform-pipeline.ts`](./src/transform-pipeline.ts)
- Default provider transform registry: [`src/provider-transform.ts`](./src/provider-transform.ts)
- Adapter-local transform example, OpenAI Chat include usage: [`src/protocols/openai-chat.ts`](./src/protocols/openai-chat.ts)
- Provider-specific wrapper transform, OpenRouter options: [`src/providers/openrouter.ts`](./src/providers/openrouter.ts)

The pipeline has five phases:

```ts
type TransformPhase = "request" | "prompt" | "tool-schema" | "payload" | "stream"
```

The phases used today are:

- `prompt`: rewrite message history before protocol lowering.
- `tool-schema`: rewrite tool JSON Schema before protocol lowering.
- `payload`: adapter-local only; rewrite the provider-native payload after lowering and before HTTP encoding.

The phases available but not heavily used today are:

- `request`: reserved for whole-request policy before prompt/tool-schema transforms.
- `stream`: reserved for normalized event rewrites after provider parsing.

There are two transform sources because they solve different problems:

- Adapter-local transforms belong to one adapter's wire format. They are payload-only today, because the adapter owns `Payload`. Use them for things like `includeUsage` or OpenRouter payload options.
- Runtime/default transforms are cross-adapter policy. They never touch provider-native payloads; they only clean the canonical request, prompt history, tool schemas, or normalized events.

If every tweak lived on adapters, cross-cutting behavior would either be duplicated across many adapters or hidden inside protocols where callers cannot turn it off. If payload tweaks were global, runtime code could mutate native payloads it does not own. The split keeps protocol semantics stable, adapter payload quirks close to adapters, and runtime policy configurable at `LLM.make(...)` / `LLMClient.make(...)`.

Default transforms are enabled by `LLM.make(...)` through `ProviderTransform.defaults`. Direct `LLMClient.make(...)` callers opt in by passing `transforms`, or by using adapters that include adapter-local payload transforms.

Today the default provider transforms do concrete work:

- Anthropic and Bedrock: remove empty text/reasoning content that those APIs reject.
- Claude: scrub tool call IDs to Claude's accepted character set.
- Mistral/Devstral: shorten and scrub tool call IDs, and repair tool-result/user-message ordering.
- Anthropic/Claude: split malformed assistant turns so `tool_use` blocks are not followed by non-tool content.
- DeepSeek/OpenAI-compatible reasoning models: move common reasoning content into provider-native replay fields.
- Unsupported media: turn unsupported user attachments into model-visible error text instead of sending a provider-invalid request.
- Moonshot/Kimi: sanitize tool JSON Schema shapes the provider rejects.
- Prompt caching: mark cache-capable providers' first system parts and last message text blocks with ephemeral cache hints.

Adapter-local payload transforms are used where the quirk is specific to one adapter deployment:

- OpenAI Chat and OpenAI-compatible Chat: `includeUsage` adds `stream_options.include_usage` so streaming responses include the final usage chunk.
- OpenRouter: `applyOptions` lifts `usage`, `reasoning`, and `prompt_cache_key` model options into the OpenRouter Chat payload.

The important idea is that payload transforms operate after protocol lowering but before payload validation and HTTP encoding. They are adapter-local only, which gives providers a typed place to add `stream_options`, OpenRouter routing options, or other native fields without giving runtime/global policy access to private payload shapes.

The tests to read are [`test/transform.test.ts`](./test/transform.test.ts), [`test/transform-pipeline.test.ts`](./test/transform-pipeline.test.ts), and [`test/adapter.test.ts`](./test/adapter.test.ts).

## 9. Tools Are Typed End To End

The public tutorial shows typed tools in [`example/tutorial.ts`](./example/tutorial.ts). The implementation is in [`src/tool.ts`](./src/tool.ts) and [`src/tool-runtime.ts`](./src/tool-runtime.ts).

What is worth showing:

- Tool definitions use Effect Schema for inputs and success values: [`src/tool.ts`](./src/tool.ts)
- Tool runtime streams model output, dispatches tool calls, validates results, and loops: [`src/tool-runtime.ts`](./src/tool-runtime.ts)
- Unknown tools, invalid input, and handler failures become model-visible tool errors: [`test/tool-runtime.test.ts`](./test/tool-runtime.test.ts)
- Provider-executed tools pass through without client dispatch: [`src/tool-runtime.ts`](./src/tool-runtime.ts)

The common event model is what makes this work across providers. Providers emit `tool-input-delta`, `tool-call`, `tool-result`, and `request-finish` events; the runtime consumes those events and decides whether another model round is needed.

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
- Safe provider quirks because adapter-local transforms rewrite provider payloads after lowering but before validation.
- Common UI/runtime events because every provider parser emits `LLMEvent`s.
- Tool-loop portability because `ToolRuntime` consumes common tool events instead of provider-specific streams.
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
3. Compare `OpenAIChat.protocol` reuse with a different adapter id and endpoint.
4. Open [`src/providers/openrouter.ts`](./src/providers/openrouter.ts) to show provider-specific options layered as an adapter-local transform.
5. Open [`src/providers/openai-compatible-profile.ts`](./src/providers/openai-compatible-profile.ts) to show family metadata and defaults.

For a testing demo:

1. Open [`test/lib/http.ts`](./test/lib/http.ts).
2. Open [`test/provider/openai-chat.test.ts`](./test/provider/openai-chat.test.ts).
3. Open [`test/recorded-test.ts`](./test/recorded-test.ts).
4. Open [`test/recorded-scenarios.ts`](./test/recorded-scenarios.ts).
5. Run `RECORDED_PROVIDER=openai bun run test` from `packages/llm`.
6. Run `bun script/recording-cost-report.ts` from `packages/llm` when cassette costs are relevant.
