# Routes, Protocols, Transports, And Models

## Problem

The current vocabulary has become awkward:

- `Provider`
- `ModelRef`
- `Route`
- `Route.model(...)`
- `Transport`

Each term points at a real concept, but the boundaries are not obvious from the API. `Route` is especially overloaded: it sounds like a provider-facing model helper, but in practice it is the runnable route that combines protocol parsing, endpoint/auth preparation, and transport execution.

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
  capabilities: ...
  auth/baseURL/headers/options: ...
}
```

`protocol` is intentionally not stored here. It is route metadata and should be read from the registered route during prepare/stream execution. Keeping both `model.route` and `route.protocol` denormalized invites drift.

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
- applying auth/endpoint/header mechanics that are specific to transport request construction

Examples:

- HTTP JSON POST + SSE framing
- HTTP JSON POST + JSON response
- WebSocket JSON messages
- Bedrock event-stream bytes

The transport should not own provider semantic parsing.

Auth belongs here because signing and header construction are transport mechanics. HTTP bearer auth, Azure `api-key`, SigV4 signing, and WebSocket construction headers all affect how the request is sent, not how provider chunks are semantically parsed.

Bedrock Converse should eventually become an explicit transport too: `Transport.bedrockEventStream(...)` can own AWS event-stream bytes and SigV4 mechanics while `BedrockConverse.protocol` keeps request lowering and event parsing.

### Route

A route is the concrete runnable composition.

It combines:

- route id
- protocol
- transport
- endpoint/auth/header interpretation where needed by the transport

This is what the old `Adapter` concept really was.

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

Rename the old `Adapter` concept to `Route` as a coordinated public API change, or do not rename it at all. A half-renamed world is worse than either endpoint.

The coherent target is:

- `Adapter` type/module concept -> `Route`
- `adapterRegistry` -> `routeRegistry`
- `model.adapter` -> `model.route`
- `PreparedRequest.adapter` -> `PreparedRequest.route`
- remove `model.protocol`; derive protocol from the registered route

Current shape:

```ts
Route.make({
  id: "openai-responses",
  protocol,
  endpoint,
  framing,
})

Route.make({
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

Routes carry provider identity directly, plus capabilities, limits, and generation defaults. Reuse happens by deriving a new route with `.with(...)`, not by layering "configuration" onto a separate raw route.

The authoring shape is a single route value:

```ts
const model = openAIResponses.model("gpt-4.1-mini", { apiKey })
```

`route.model(...)` is better than `Provider.model(...)`: a provider is the catalog namespace, while a provider-bound route owns route-backed model-ref construction. Capabilities live as route defaults and on the final `ModelRef`, and remain overridable because capabilities and limits can vary by concrete model id.

Provider helpers map user options to concrete provider-bound routes:

```ts
const responsesRoutes = {
  http: openAIResponses,
  websocket: openAIResponsesWebSocket,
} as const
```

The generated helper can support:

```ts
OpenAI.responses("gpt-4.1-mini")
OpenAI.responses("gpt-4.1-mini", { transport: "http" })
OpenAI.responses("gpt-4.1-mini", { transport: "websocket" })
```

and produce a concrete `ModelRef` with `route` set to the selected route id.

## Why Not Multi-Transport Adapters?

A tempting shape is:

```ts
Route.make({
  id: "openai-responses",
  protocol,
  transports: {
    http: Transport.httpJson(...),
    websocket: Transport.webSocketJson(...),
  },
})
```

This is reasonable if the object is renamed to `RouteFamily`, but it is awkward if it remains the executable route. A runnable route should be concrete. A route family is a provider/model helper concern.

Problems with late multi-transport route selection:

- `prepare(...)` cannot describe one concrete prepared request shape.
- recorded tests need to know which cassette/transport route is active.
- runtime layer requirements become conditional and less obvious.
- route metadata becomes less useful for debugging.
- errors happen later and are harder to tie to a provider helper call.

Better split:

- `Route`: one runnable route.
- provider helper route table: optional route family selector that chooses a concrete route-backed model factory while building `ModelRef`.

Route families may exist as local provider-helper implementation detail, but they should not replace concrete routes in the registry.

## Route Derivation Smells

The current code still has several related smells:

- Protocol files expose hand-written `makeRoute(...)` factories.
- Provider files derive variants by passing knobs like `defaultBaseURL: false` and `endpointRequired` into those factories.
- Provider identity and capabilities are added later through `Route.model(route, defaults)` rather than being visibly attached to a provider-bound route.
- The same reusable route shape sometimes acts like a base and sometimes acts like a user-facing provider route.

These are all symptoms of the same missing concept: route derivation.

### Endpoint Policy Smell

`defaultBaseURL: false` means "do not use the route's default URL; require the model/provider options to supply one."

`endpointRequired` is the custom error message used when no base URL is available.

This is too implicit. It makes provider variants read like they are toggling random endpoint internals:

```ts
OpenAIResponses.makeRoute({
  id: "azure-openai-responses",
  defaultBaseURL: false,
  endpointRequired: "Azure OpenAI requires resourceName or baseURL",
})
```

The intended behavior is really an endpoint policy:

```ts
Endpoint.baseURL({
  path: "/responses",
  default: "https://api.openai.com/v1",
})

Endpoint.requiredBaseURL({
  path: "/responses",
  message: "Azure OpenAI requires resourceName or baseURL",
})
```

or one API with explicit variants:

```ts
Endpoint.baseURL({
  path: "/responses",
  base: { type: "default", url: "https://api.openai.com/v1" },
})

Endpoint.baseURL({
  path: "/responses",
  base: { type: "required", message: "Azure OpenAI requires resourceName or baseURL" },
})
```

The route should not expose `defaultBaseURL: false`; it should expose an endpoint with a clear policy.

### Hand-Written Factory Smell

This shape is a smell:

```ts
export const makeRoute = (input = {}) =>
  Route.make({
    id: input.id ?? "openai-responses",
    protocol,
    endpoint: input.endpoint ?? endpoint(...),
    auth: input.auth,
    framing: Framing.sse,
  })
```

It exists only because route values are not yet easy to copy and modify.

The target is immutable derivation on a single `Route` value:

```ts
export const openAIResponses = Route.make({
  id: "openai-responses",
  provider: "openai",
  protocol: OpenAIResponses.protocol,
  transport: Transport.httpJson({
    endpoint: Endpoint.baseURL({ path: "/responses", base: { type: "default", url: DEFAULT_BASE_URL } }),
    auth: Auth.bearer(),
    framing: Framing.sse,
  }),
  defaults: {
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
})

export const azureResponses = openAIResponses.with({
  id: "azure-openai-responses",
  provider: "azure",
  transport: openAIResponses.transport.with({
    endpoint: Endpoint.requiredBaseURL({ path: "/responses", message: "Azure OpenAI requires resourceName or baseURL" }),
    auth: azureAuth,
  }),
})
```

This preserves reuse without hiding variant behavior behind protocol-specific factory parameters, and without a second route concept.

### One Route Concept

There is one `Route` concept. No `RouteTemplate`, no separate base/derived split.

Every route used by a provider helper should have a provider. Reuse happens by immutably deriving one provider route from another:

```ts
export const responses = Route.make({
  id: "openai-responses",
  provider: "openai",
  protocol: OpenAIResponses.protocol,
  transport: Transport.httpJson({
    endpoint: Endpoint.baseURL({ path: "/responses", base: { type: "default", url: DEFAULT_BASE_URL } }),
    auth: Auth.bearer(),
    framing: Framing.sse,
  }),
  defaults: {
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
})

export const azureResponses = responses.with({
  id: "azure-openai-responses",
  provider: "azure",
  transport: responses.transport.with({
    endpoint: Endpoint.requiredBaseURL({ path: "/responses", message: "Azure OpenAI requires resourceName or baseURL" }),
    auth: azureAuth,
  }),
})
```

The risk is inherited provider/default leakage. Mitigate that with API shape:

- `.with(...)` is immutable and returns a new route.
- deriving a provider route should require `id` and `provider` when either changes.
- duplicate route ids should fail or be explicit.
- provider is route identity; capabilities/limits/generation are route defaults and remain overridable by model options.
- `.model(...)` uses the route defaults and returns a concrete `ModelRef` with `route` set.

### Typed Transport Derivation

Transport replacement should not force callers to restate unrelated internals.

This is awkward:

```ts
const azureResponses = responses.with({
  id: "azure-openai-responses",
  provider: "azure",
  transport: Transport.httpJson({
    endpoint: Endpoint.requiredBaseURL(...),
    auth: azureAuth,
    framing: Framing.sse, // only repeated because the whole transport was rebuilt
  }),
})
```

Transport values should be immutable and copyable too:

```ts
const azureResponses = responses.with({
  id: "azure-openai-responses",
  provider: "azure",
  transport: responses.transport.with({
    endpoint: Endpoint.requiredBaseURL(...),
    auth: azureAuth,
  }),
})
```

For authoring ergonomics, route can expose typed transport-specific helpers:

```ts
const azureResponses = responses.withHttpJson({
  id: "azure-openai-responses",
  provider: "azure",
  endpoint: Endpoint.requiredBaseURL(...),
  auth: azureAuth,
})
```

`withHttpJson(...)` should only exist on HTTP JSON routes. WebSocket routes get WebSocket-specific derivation:

```ts
const customResponsesWs = responsesWebSocket.withWebSocket({
  id: "custom-openai-responses-websocket",
  endpoint: customEndpoint,
  auth: customAuth,
})
```

This gives a useful type-level distinction without adding a second route concept:

```ts
Route<Payload, Prepared, Frame, Transport>
```

The route knows its transport type, so derivation can offer the right partial override API for that transport.

### Coherent Target

The smallest coherent target that addresses all these smells:

- Replace protocol-specific `makeRoute(...)` factories with immutable route derivation.
- Replace `defaultBaseURL: false` / `endpointRequired` with explicit endpoint policies.
- Treat provider/capabilities/limits/generation as route defaults that can be overridden by model options.
- Keep one `Route` concept; reuse happens through immutable `.with(...)` derivation.
- Make transports immutable/copyable so provider variants can override endpoint/auth without restating framing or unrelated transport internals.
- Let provider modules export provider-bound routes and model helpers as the primary API.

## Registry Semantics

Routes are registered by route id, not by provider/model id.

```ts
routeRegistry.set("openai-responses", responsesHttpRoute)
routeRegistry.set("openai-responses-websocket", responsesWebSocketRoute)
```

`ModelRef` carries the selected route id:

```ts
OpenAI.responses("gpt-4.1-mini", { transport: "websocket" })
// ModelRef { provider: "openai", id: "gpt-4.1-mini", route: "openai-responses-websocket" }
```

Execution resolves the route:

```ts
const route = routeRegistry.get(request.model.route)
```

Importing a provider module should register the routes that its exported helpers can select. For `OpenAI.responses(...)`, that means both the HTTP and WebSocket Responses routes are available once the OpenAI provider module is imported. If bundle size or tree-shaking later require finer control, route registration can become explicit, but selector sugar must never produce a `ModelRef` for a route that was not registered by the same import path.

## Prepared Requests And Metadata

Prepared requests should expose concrete route details.

Prepared output should be concrete and derived from route resolution:

```ts
PreparedRequest {
  route: "openai-responses-websocket"
  protocol: "openai-responses"
  transport: "websocket-json"
}
```

`PreparedRequest.protocol` is acceptable because prepare has already resolved the route. It is derived output metadata, not duplicated model configuration.

## OpenCode Config Constraint

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

The package-level constraint is simple: transport selection must be string-serializable and route-agnostic enough for config files.

Bridge behavior can be:

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

### Step 1: Rename Adapter To Route Publicly

Do this as one coordinated schema/API change, not as a partial internal alias.

Rename:

- `Adapter` export -> `Route`
- `AdapterShape` -> `RouteShape`
- `AdapterContext` -> `RouteContext`
- `AnyAdapter` -> `AnyRoute`
- `routeRegistry` -> `routeRegistry`
- `model.adapter` -> `model.route`
- `PreparedRequest.adapter` -> `PreparedRequest.route`
- error reason fields from `adapter` to `route` where they identify the runnable route

Remove:

- `model.protocol`

Derive protocol from route metadata after route resolution. If missing-route errors need extra context, route id plus provider/model id are sufficient.

Temporary compatibility aliases are acceptable only if they are clearly deprecated and not used in new code/docs.

### Step 2: Move `.model(...)` Onto The Route

Current implementation can keep `Route.model(route, defaults)` while the rename lands. The cleaner target is `route.model(id, options)` directly on the provider-bound route — provider, capabilities, limits, and generation already live on the route, and `.with(...)` covers any per-derivation overrides.

```ts
const model = openAIResponses.model("gpt-4.1-mini", { apiKey })
```

Do not move this to `Provider.model(...)`. A provider is the catalog namespace; routes own route-backed model-ref construction.

### Step 3: Keep Runtime Behavior Stable

Keep current runtime behavior:

- `Route.make(...)` supports explicit transports.
- `OpenAI.responses(...)` returns HTTP SSE.
- `OpenAI.responsesWebSocket(...)` returns WebSocket.
- Both routes share `OpenAIResponses.protocol`.

### Step 4: Add Transport Selector Sugar

Add `transport?: "http" | "websocket"` to OpenAI Responses model helper options.

Implementation rule:

- select route inside `OpenAI.responses(...)`
- return a concrete `ModelRef`
- do not defer selection to execution

Keep `OpenAI.responsesWebSocket(...)` permanently as the canonical discoverable alias. The option-style form is ergonomic sugar; the alias is load-bearing for code search and explicitness.

## Open Questions

- Is `Route` the best name, or is `ModelRoute` clearer because routes are selected by models?
- Should route families become a named helper type, or remain local provider-helper implementation detail?

## Recommendation

Adopt this mental model:

- `Provider`: catalog and user helper namespace.
- `ModelRef`: concrete selected model plus selected route id.
- `Protocol`: semantic lowering/parsing.
- `Transport`: mechanics for moving frames.
- `Route`: concrete runnable protocol + transport composition.

Commit to the public `Route -> Route` rename if we pursue this plan. Keep route selection at model construction time. Let provider helpers expose ergonomic transport choices, but always resolve them into concrete route ids before requests execute. Store the selected route id on `ModelRef`; derive protocol from the route registry.
