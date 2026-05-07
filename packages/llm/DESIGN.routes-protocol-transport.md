# Routes, Protocols, Transports, And Models

## Problem

The current vocabulary has become awkward:

- `Provider`
- `ModelRef`
- `Adapter`
- `Adapter.model(...)`
- `Transport`

Each term points at a real concept, but the boundaries are not obvious from the API. `Adapter` is especially overloaded: it sounds like a provider-facing model helper, but in practice it is the runnable route that combines protocol parsing, endpoint/auth preparation, and transport execution.

OpenAI Responses over both HTTP SSE and WebSocket made this visible. Both routes share the same semantic protocol and parser, but they move frames differently. That should be easy to express without making model/provider metadata feel attached to a transport implementation.

## Requirements

We need to express five separate ideas.

### Provider

A provider is a catalog namespace and convenience API surface, such as `openai`, `anthropic`, `google`, or `xai`.

Provider code should answer: "What named model helpers do users call?"

Examples:

```ts
OpenAI.responses("gpt-4.1-mini")
Anthropic.messages("claude-sonnet-4-5")
Google.gemini("gemini-2.5-pro")
```

### Model Selection

A model selection is the concrete user-selected model instance.

It should contain:

- provider id
- model id
- selected runnable route id
- capabilities
- auth/base URL/headers/options

It should not contain parser or transport implementation.

Example shape:

```ts
ModelRef {
  provider: "openai"
  id: "gpt-4.1-mini"
  route: "openai-responses-websocket"
  protocol: "openai-responses"
  capabilities: ...
  auth/baseURL/headers/options: ...
}
```

### Protocol

A protocol is the semantic API contract.

It owns:

- request lowering from common `LLMRequest` to provider-native payload
- payload schema
- chunk schema
- stream state machine
- common event parsing
- terminal chunk detection

Examples:

- `openai-responses`
- `openai-chat`
- `anthropic-messages`
- `gemini`
- `bedrock-converse`

The protocol should be shared across transports when the provider emits the same semantic stream shape.

OpenAI Responses HTTP SSE and OpenAI Responses WebSocket should both use the same `OpenAIResponses.protocol`.

### Transport

A transport is the mechanical route for moving frames.

It owns:

- preparing transport-private request data
- executing or opening the transport
- turning raw transport output into protocol frames

Examples:

- HTTP JSON POST + SSE framing
- HTTP JSON POST + JSON response
- WebSocket JSON messages
- Bedrock event-stream bytes

The transport should not own provider semantic parsing.

### Route

A route is the concrete runnable composition.

It combines:

- route id
- protocol
- transport
- endpoint/auth/header interpretation where needed by the transport

This is what the current `Adapter` really is.

Example:

```ts
const responsesHttpRoute = Route.make({
  id: "openai-responses",
  protocol: OpenAIResponses.protocol,
  transport: Transport.httpJson({
    endpoint: OpenAIResponses.endpoint(),
    auth: Auth.bearer(),
    framing: Framing.sse,
  }),
})

const responsesWebSocketRoute = Route.make({
  id: "openai-responses-websocket",
  protocol: OpenAIResponses.protocol,
  transport: Transport.webSocketJson({
    endpoint: OpenAIResponses.endpoint(),
    auth: Auth.bearer(),
    messageType: "response.create",
  }),
})
```

## Ideal Userland API

The public API should optimize for model selection, not implementation mechanics.

Default path:

```ts
const model = OpenAI.responses("gpt-4.1-mini", {
  apiKey: process.env.OPENAI_API_KEY,
})
```

WebSocket path:

```ts
const model = OpenAI.responses("gpt-4.1-mini", {
  apiKey: process.env.OPENAI_API_KEY,
  transport: "websocket",
})
```

Explicit alias remains useful for discoverability and code search:

```ts
const model = OpenAI.responsesWebSocket("gpt-4.1-mini", {
  apiKey: process.env.OPENAI_API_KEY,
})
```

Both WebSocket forms should resolve immediately to the same concrete model ref:

```ts
ModelRef {
  provider: "openai"
  id: "gpt-4.1-mini"
  route: "openai-responses-websocket"
  protocol: "openai-responses"
}
```

Transport selection should happen at model construction time, not during request execution.

Avoid:

```ts
LLM.request({
  model: OpenAI.responses("gpt-4.1-mini"),
  http: { transport: "websocket" },
})
```

Also avoid storing a late selector that execution resolves dynamically:

```ts
ModelRef {
  provider: "openai"
  id: "gpt-4.1-mini"
  transport: "websocket" // unresolved until stream time
}
```

Late selection makes errors, prepared requests, recordings, and route metadata less clear.

## Ideal Internal API

Rename the current `Adapter` concept to `Route` over time.

Current shape:

```ts
Adapter.make({
  id: "openai-responses",
  protocol,
  endpoint,
  framing,
})

Adapter.make({
  id: "openai-responses-websocket",
  protocol,
  transport,
})
```

Proposed shape:

```ts
Route.make({
  id: "openai-responses",
  protocol,
  transport: Transport.httpJson({ endpoint, auth, framing }),
})

Route.make({
  id: "openai-responses-websocket",
  protocol,
  transport: Transport.webSocketJson({ endpoint, auth, messageType: "response.create" }),
})
```

Provider helpers should map user options to concrete routes:

```ts
const responsesRoutes = {
  http: responsesHttpRoute,
  websocket: responsesWebSocketRoute,
} as const

export const responses = Provider.model({
  provider: "openai",
  defaultRoute: responsesRoutes.http,
  routes: responsesRoutes,
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})
```

The generated helper can support:

```ts
OpenAI.responses("gpt-4.1-mini")
OpenAI.responses("gpt-4.1-mini", { transport: "websocket" })
```

and produce a concrete `ModelRef` with `route`/current `adapter` set to the selected route id.

## Why Not Multi-Transport Adapters?

A tempting shape is:

```ts
Adapter.make({
  id: "openai-responses",
  protocol,
  transports: {
    http: Transport.httpJson(...),
    websocket: Transport.webSocketJson(...),
  },
})
```

This is reasonable if the object is renamed to `RouteFamily`, but it is awkward if it remains the executable adapter. A runnable route should be concrete. A route family is a provider/model helper concern.

Problems with late multi-transport adapter selection:

- `prepare(...)` cannot describe one concrete prepared request shape.
- recorded tests need to know which cassette/transport route is active.
- runtime layer requirements become conditional and less obvious.
- route metadata becomes less useful for debugging.
- errors happen later and are harder to tie to a provider helper call.

Better split:

- `Route`: one runnable route.
- `Provider.model(...)`: optional route family selector that chooses a concrete route while building `ModelRef`.

## Prepared Requests And Metadata

Prepared requests should expose concrete route details.

Current names can remain during migration:

```ts
PreparedRequest {
  adapter: "openai-responses-websocket"
  model.protocol: "openai-responses"
  metadata: { transport: "websocket-json" }
}
```

Long-term names should be clearer:

```ts
PreparedRequest {
  route: "openai-responses-websocket"
  protocol: "openai-responses"
  transport: "websocket-json"
}
```

## OpenCode Config API

OpenCode can expose user-friendly provider options while still resolving to a concrete route before execution.

Example config:

```json
{
  "provider": {
    "openai": {
      "options": {
        "transport": "websocket"
      }
    }
  }
}
```

Bridge behavior:

```ts
const model = options.transport === "websocket"
  ? OpenAI.responses(id, { ...options, transport: "websocket" })
  : OpenAI.responses(id, options)
```

or equivalently:

```ts
const model = OpenAI.responses(id, options)
```

if `OpenAI.responses` itself owns route selection.

The bridge should not pass transport selection through `LLM.request.http`.

## Migration Plan

### Step 1: Stabilize Current Implementation

Keep current runtime behavior:

- `Adapter.make(...)` supports both HTTP composition and explicit custom transports.
- `OpenAI.responses(...)` returns HTTP SSE.
- `OpenAI.responsesWebSocket(...)` returns WebSocket.
- Both routes share `OpenAIResponses.protocol`.

### Step 2: Introduce Route Naming Internally

Add aliases without breaking existing imports:

```ts
export const Route = Adapter
export type Route = AdapterShape
```

Prefer `Route` in new internal code and docs.

Keep `Adapter` as a compatibility alias until the rest of the package has moved.

### Step 3: Move Model Factory Naming Out Of Adapter

Replace callsites like:

```ts
Adapter.model(route, defaults)
```

with clearer provider/model helper naming:

```ts
Provider.model(route, defaults)
```

or:

```ts
ModelFactory.fromRoute(route, defaults)
```

This keeps provider metadata attached to model construction, not to the route itself.

### Step 4: Add Transport Selector Sugar

Add `transport?: "http" | "websocket"` to OpenAI Responses model helper options.

Implementation rule:

- select route inside `OpenAI.responses(...)`
- return a concrete `ModelRef`
- do not defer selection to execution

### Step 5: Rename Metadata Carefully

If worth the churn, rename schema fields later:

- `model.adapter` -> `model.route`
- `PreparedRequest.adapter` -> `PreparedRequest.route`

This likely needs a compatibility period because these fields may be user-visible.

## Open Questions

- Should `transport: "http"` be accepted explicitly, or should only non-default transports be named?
- Should explicit aliases like `OpenAI.responsesWebSocket(...)` remain permanently for discoverability?
- Is `Route` the best name, or is `ModelRoute` clearer because routes are selected by models?
- Should `Protocol` ids stay on `ModelRef`, or are they derivable from route metadata at prepare time?
- Should route families exist as a named internal concept, or only inside provider helper implementation?

## Recommendation

Adopt this mental model:

- `Provider`: catalog and user helper namespace.
- `ModelRef`: concrete selected model plus selected route id.
- `Protocol`: semantic lowering/parsing.
- `Transport`: mechanics for moving frames.
- `Route`: concrete runnable protocol + transport composition.

Keep route selection at model construction time. Let provider helpers expose ergonomic transport choices, but always resolve them into concrete route ids before requests execute.
