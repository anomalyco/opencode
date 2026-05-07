# WebSocket Transport Proposal

## Status

Proposal: keep OpenAI WebSocket support as a transport-level route route that reuses the existing OpenAI Responses protocol.

The implementation should deepen the route seam without making protocol authors think about sockets and without turning WebSocket into a provider option hidden inside an existing HTTP route.

## Goal

Support OpenAI's WebSocket Responses backend in `@opencode-ai/llm` while preserving the current protocol architecture:

- `Protocol` owns provider semantics: request lowering, payload schema, stream chunk schema, and chunk-to-`LLMEvent` parsing.
- `Transport` owns movement: HTTP request/response, SSE framing, WebSocket message flow, and platform execution.
- `Route` composes one protocol with one transport route.
- Effect services provide runtime capabilities such as HTTP execution and WebSocket construction.

The key result should be an explicit model constructor:

```ts
const model = OpenAI.responsesWebSocket("gpt-4.1-mini", { apiKey })
```

Existing constructors keep their current behavior:

```ts
OpenAI.model("gpt-4.1-mini") // OpenAI Responses over HTTP SSE
OpenAI.responses("gpt-4.1-mini") // OpenAI Responses over HTTP SSE
OpenAI.chat("gpt-4o-mini") // OpenAI Chat over HTTP SSE
```

## Current State

`src/route/client.ts` currently combines two separate ideas in one module:

- route registry, request option resolution, payload validation, and response collection
- HTTP-specific execution details through `toHttp(...)`, `RequestExecutor.Service`, and `route.parse(response, context)`

The current runtime path is:

```text
LLMRequest
  -> protocol.toPayload
  -> protocol.payload validation
  -> route.toHttp
  -> RequestExecutor.execute
  -> route.parse(HttpClientResponse)
  -> Framing
  -> protocol.chunk
  -> protocol.process
  -> LLMEvent
```

That path is correct for HTTP providers, but it bakes in the assumption that every route produces an `HttpClientRequest` and consumes an `HttpClientResponse`.

Effect's OpenAI implementation does not fork the language model protocol for WebSocket mode. It builds the normal `/responses` request URL and headers, converts the URL from `http` to `ws`, sends a `response.create` message, and decodes the same OpenAI Responses stream event schema.

## Non-Goals

- Do not fork `OpenAIResponses.protocol`.
- Do not hide WebSocket behind `providerOptions.openai.websocket`.
- Do not put non-HTTP behavior in `HttpOptions`.
- Do not require all normal HTTP users to provide a WebSocket layer.
- Do not implement persistent socket pooling in the first patch.
- Do not generalize toward bidirectional audio/realtime sessions yet. This proposal covers request/response streaming through OpenAI Responses WebSocket mode.

## Proposed Split

Introduce a small internal `Transport` module and move the existing HTTP-specific route execution behind it.

The depth test for this module is important: do not add `Transport` only as a one-off wrapper around OpenAI WebSocket. It earns its keep only if the current HTTP path also moves behind the same seam, so `client.ts` stops knowing whether a route is HTTP or WebSocket.

```text
src/route/client.ts              registry, model refs, compile/stream/generate
src/route/transport.ts           type-safe transport seam
src/route/http-transport.ts      current HTTP JSON POST + response framing behavior
src/route/websocket-executor.ts  WebSocket runtime capability and error mapping
src/protocols/openai-responses.ts  existing protocol + HTTP route + WebSocket route
src/providers/openai.ts            provider-facing constructors
```

The conceptual runtime path becomes:

```text
LLMRequest
  -> protocol.toPayload
  -> protocol.payload validation
  -> transport.prepare
  -> transport.frames
  -> protocol.chunk
  -> protocol.process
  -> LLMEvent
```

HTTP and WebSocket differ only in `transport.prepare` and `transport.frames`. Existing `Endpoint`, `Auth`, and `Framing` stay separate modules; `Transport` composes them for a runnable movement path rather than replacing them.

## Type-Safe Transport Interface

The transport seam should be generic inside the route implementation. The registry can erase route types, just like it already erases payload types today, but individual transport constructors should keep `Payload`, `Prepared`, and `Frame` connected.

```ts
export interface TransportContext {
  readonly request: LLMRequest
}

export interface TransportRuntime {
  readonly http: RequestExecutor.Interface
  readonly webSocket?: WebSocketExecutor.Interface
}

export interface Transport<Payload, Prepared, Frame> {
  readonly id: string
  readonly prepare: (payload: Payload, context: TransportContext) => Effect.Effect<Prepared, LLMError>
  readonly frames: (
    prepared: Prepared,
    context: TransportContext,
    runtime: TransportRuntime,
  ) => Stream.Stream<Frame, LLMError>
}
```

`Prepared` is transport-private and remains type-safe while implementing the transport:

```ts
type HttpPrepared = {
  readonly request: HttpClientRequest.HttpClientRequest
}

type OpenAIResponsesWebSocketPrepared = {
  readonly url: string
  readonly headers: Headers.Headers
  readonly message: OpenAIResponsesWebSocketMessage
}
```

The route keeps the generic relationship through construction:

```ts
export interface MakeInput<Payload, Prepared, Frame, Chunk, State> {
  readonly id: string
  readonly protocol: Protocol<Payload, Frame, Chunk, State>
  readonly transport: Transport<Payload, Prepared, Frame>
}
```

The route registry can still erase these generics internally, but that erasure should remain local to `client.ts` as it does today:

```ts
// local registry erasure only; do not expose this from public route modules
// oxlint-disable-next-line typescript-eslint/no-explicit-any
type AnyRoute = Route<any, any>
```

Do not use `unknown` for the internal registry unless TypeScript variance proves it assignable. The type-safety goal is that `Transport<Payload, Prepared, Frame>` is checked at construction time; registry erasure is an implementation detail after construction.

## Route Runner

`Route.make(...)` should become the generic runner constructor:

```ts
export function make<Payload, Prepared, Frame, Chunk, State>(
  input: MakeInput<Payload, Prepared, Frame, Chunk, State>,
): Route<Payload, Prepared> {
  const decodePayload = ProviderShared.validateWith(Schema.decodeUnknownEffect(input.protocol.payload))
  const decodeChunk = Schema.decodeUnknownEffect(input.protocol.chunk)

  return register({
    id: input.id,
    protocol: input.protocol.id,
    payloadSchema: input.protocol.payload,
    toPayload: input.protocol.toPayload,
    prepareTransport: (payload, context) => input.transport.prepare(payload, context),
    streamPrepared: (prepared, context, runtime) =>
      input.transport.frames(prepared, context, runtime).pipe(
        Stream.mapEffect((frame) => decodeChunk(frame)),
        // same state-machine fold used today by ProviderShared.framed
      ),
  })
}
```

This preserves the public `LLMClient.prepare`, `LLMClient.stream`, and `LLMClient.generate` shape. `LLMClient.layer` captures a `TransportRuntime` once and passes it to routes internally, so caller-facing methods remain environment-free.

`PreparedRequest.payload` remains `unknown` externally, with `PreparedRequestOf<Payload>` available for callers that know the route payload type. The transport-private `Prepared` type should not be exposed in `PreparedRequest` or provider-facing APIs.

`PreparedRequest.metadata` can record the transport id for debugging:

```ts
metadata: {
  transport: "websocket"
}
```

That is additive and optional.

## HTTP Transport

The existing `Route.make(...)` input shape should remain available for ordinary routes by re-expressing it as a helper around `Transport.httpJson(...)`.

```ts
export const route = Route.makeHttp({
  id: "openai-responses",
  protocol: OpenAIResponses.protocol,
  endpoint: Endpoint.baseURL({ default: "https://api.openai.com/v1", path: "/responses" }),
  auth: Auth.bearer(),
  framing: Framing.sse,
})
```

`makeHttp(...)` should preserve today's route author ergonomics and internally build:

```ts
Transport.httpJson({ endpoint, auth, framing, headers })
```

This keeps the first WebSocket patch small because existing protocol files do not need to change unless they opt into a non-HTTP route.

## OpenAI Responses WebSocket Transport

Add a WebSocket route route in `src/protocols/openai-responses.ts`:

```ts
export const websocketAdapter = Route.make({
  id: "openai-responses-websocket",
  protocol,
  transport: Transport.openAIResponsesWebSocket({
    endpoint: endpoint(),
    auth: Auth.bearer(),
  }),
})
```

The WebSocket transport should:

1. Reuse the same endpoint renderer as HTTP: default `https://api.openai.com/v1/responses`.
2. Reuse the same `Auth` path as HTTP so model-level `auth` overrides and `OPENAI_API_KEY` fallback continue to work.
3. Convert `https:` to `wss:` and `http:` to `ws:`.
4. Send one JSON message:

```ts
{
  type: "response.create",
  ...payloadWithoutStream,
}
```

OpenAI's generated schema notes that `stream` is implicit over WebSocket and should not be sent.

5. Treat each incoming text WebSocket message as one JSON frame for `OpenAIResponses.protocol.chunk`.
6. Close or interrupt the socket after the protocol observes a terminal chunk.

The message type should be typed from the existing payload:

```ts
type OpenAIResponsesWebSocketMessage = Omit<OpenAIResponsesPayload, "stream"> & {
  readonly type: "response.create"
}
```

That type is not enough by itself. The implementation must explicitly omit `stream` at runtime before encoding, and the sent message should be encoded through an Effect Schema JSON codec rather than direct unvalidated `JSON.stringify`.

## Protocol Terminal Signal

HTTP SSE streams end naturally. A WebSocket stream may remain open, so the route runner needs protocol help to know when one request is complete.

Add an optional protocol method:

```ts
export interface Protocol<Payload, Frame, Chunk, State> {
  readonly terminal?: (chunk: Chunk) => boolean
}
```

For OpenAI Responses:

```ts
terminal: (chunk) =>
  chunk.type === "response.completed" || chunk.type === "response.incomplete" || chunk.type === "response.failed"
```

The terminal signal is protocol knowledge. The transport should not need to know OpenAI event names.

The runner should apply the terminal check after chunk decoding and processing, so the terminal chunk still emits its final `request-finish` or provider error event.

## Effect Services And Layers

Follow the package's existing Effect style: `Context.Service` plus `Layer.effect(...)` returning `Service.of(...)`.

Add a dedicated WebSocket service because socket construction, header support, close handling, and transport-error mapping are runtime concerns:

```ts
export interface Interface {
  readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/WebSocketExecutor") {}
```

The service should hide platform differences and expose a package-local shape, not raw `globalThis.WebSocket`:

```ts
export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, LLMError>
  readonly messages: Stream.Stream<string | Uint8Array, LLMError>
  readonly close: Effect.Effect<void, never>
}
```

Do not make a second constructor service just to model header-capable WebSockets. The deep runtime seam is `WebSocketExecutor.Service`: tests, Bun, Node `ws`, or future platform layers can provide `open(...)` directly. The executor may expose a helper for wrapping an already-created `globalThis.WebSocket`, but route code should depend only on `WebSocketExecutor.Service`.

```ts
export const fromWebSocket: (
  ws: globalThis.WebSocket,
  request: WebSocketRequest,
) => Effect.Effect<WebSocketConnection, LLMError>
```

Browser WebSocket constructors cannot set arbitrary `Authorization` headers and should not be advertised as supporting OpenAI WebSocket auth unless an alternate auth mechanism exists.

Layer wiring options:

```ts
LLMClient.layer // HTTP only, current default
LLMClient.layerWithWebSocket // HTTP + WebSocketExecutor.Service
WebSocketExecutor.Service // exported for explicit app/test wiring
```

`LLMClient.layer` should remain enough for all existing routes. It captures a `TransportRuntime` with `http` only. `LLMClient.layerWithWebSocket` captures both `http` and `webSocket`. If a caller selects `openai-responses-websocket` without the WebSocket-capable layer, the WebSocket transport should fail with a typed transport error that says the selected route requires `WebSocketExecutor.Service`.

## Provider API

Expose the route explicitly from `src/providers/openai.ts`:

```ts
export const responsesWebSocket = (id: string | ModelID, options: OpenAIModelInput<Omit<RouteModelInput, "id">> = {}) =>
  OpenAIResponses.webSocketModel(withOpenAIOptions(id, { ...options, auth: auth(options) }, { textVerbosity: true }))

export const provider = Provider.make({
  id,
  model: responses,
  apis: { responses, chat, responsesWebSocket },
})
```

This makes transport choice visible in the model ref:

```ts
model.route // "openai-responses-websocket"
route.protocol // "openai-responses"
```

That mirrors the existing route-route versus protocol distinction used by OpenAI-compatible providers.

## Route Author Experience

HTTP route authors should keep the boring path:

```ts
export const route = Route.makeHttp({
  id: "provider-chat",
  protocol,
  endpoint: Endpoint.baseURL({ default: "https://api.provider.test/v1", path: "/chat/completions" }),
  framing: Framing.sse,
})
```

Non-HTTP route authors should write a transport and keep their prepared type private:

```ts
type Prepared = {
  readonly url: string
  readonly headers: Headers.Headers
  readonly message: ProviderMessage
}

const transport: Transport<ProviderPayload, Prepared, string> = {
  id: "provider-websocket",
  prepare: (payload, context) => ...,
  frames: (prepared, context, runtime) => ...,
}

export const route = Route.make({
  id: "provider-websocket",
  protocol,
  transport,
})
```

The route author chooses a transport frame type. The protocol author chooses a protocol frame/chunk schema. TypeScript keeps those connected through `Route.make(...)`.

## Test Plan

Add deterministic tests before live recorded tests.

Transport-level tests:

- WebSocket executor opens with redacted/auth headers.
- WebSocket executor is provided as the runtime seam, with tests supplying a fake executor instead of raw browser/global WebSocket assumptions.
- WebSocket executor maps open/write/read/close failures into `LLMError`.
- WebSocket transport sends `response.create` and omits `stream`.
- WebSocket transport converts `https` to `wss` and preserves query params.

Route-level tests:

- `OpenAI.responsesWebSocket(...)` produces `route: "openai-responses-websocket"` and `protocol: "openai-responses"`.
- `LLMClient.prepare<OpenAIResponsesPayload>(...)` returns the same payload shape as HTTP Responses.
- Incoming `response.output_text.delta` emits `text-delta`.
- Incoming function-call argument deltas emit existing tool events.
- Terminal `response.completed` emits one `request-finish` and closes/takes the stream.
- Provider `error` messages map to provider-error or typed transport error consistently with HTTP stream errors.

Regression tests:

- Existing HTTP OpenAI Responses tests remain unchanged.
- Existing `RequestExecutor` retry behavior remains HTTP-only.
- `LLMClient.layer` can still run HTTP routes without WebSocket services.
- Selecting `openai-responses-websocket` with `LLMClient.layer` fails with a clear typed missing-WebSocket-runtime error.

## Rollout Steps

1. Add `transport.ts` and `http-transport.ts` while preserving `Route.make(...)` or adding `Route.makeHttp(...)` as a compatibility helper. Do this only if the existing HTTP path moves behind the same seam in the same patch series.
2. Move the existing HTTP request-building and parsing pipeline behind `Transport.httpJson(...)` with no behavior changes.
3. Add protocol `terminal?` and wire the runner to stop after terminal chunks.
4. Add `route/transport/websocket.ts`, with tests using a fake executor layer.
5. Add OpenAI Responses WebSocket transport and route route.
6. Add `OpenAI.responsesWebSocket(...)` provider facade and export tests.
7. Add focused deterministic stream tests.
8. Optionally add recorded/live WebSocket tests behind `RECORD=true` once deterministic coverage is stable.

## Future Work

- Persistent socket pooling with a scoped `RcRef` and one-request-at-a-time semaphore, mirroring Effect's OpenAI implementation.
- A generic `Transport.webSocketJson(...)` helper if another provider needs request/response WebSocket streaming.
- Better transport diagnostics in `PreparedRequest.metadata`, such as `transport`, redacted URL, and selected header names.
- Provider-specific WebSocket retry policy. The first patch should not retry ambiguous model-generation writes automatically.
