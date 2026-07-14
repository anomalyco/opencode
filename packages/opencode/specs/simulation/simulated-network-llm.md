# Simulated Network And Driver-Scripted LLM

Status: design for the Phase 2 network and LLM items in `simulation-phases.md`.

## Summary

Simulation replaces the `HttpClient.HttpClient` platform node with a simulated network. The LLM is not replaced: an OpenAI route intercepts the real provider request and delegates its response to a **simulated model provider** controlled by the external driver. There is no server-side response script or replay adapter; the driver decides what the provider returns.

Everything above the HTTP boundary runs real: catalog and auth resolution, `LLMClient`, request body construction, SSE framing, the OpenAI protocol event schema, the `step` state machine, `Lifecycle` grammar, tool-argument accumulation, the session runner, tools, and permissions.

## Why the network seam

`LLMClient.stream` sits on a stack that ends in one platform node:

```
LLMClient.stream(request)
  route.body.from            LLMRequest -> OpenAI JSON body        (real)
  transport.prepare          body + endpoint + auth -> HttpRequest (real)
  RequestExecutor.execute    status/error taxonomy                 (real)
    HttpClient.HttpClient    <- replaced by the simulated network
  Framing.sse                bytes -> frames                       (real)
  protocol.stream.event      frame -> OpenAIChatEvent, validated   (real)
  protocol.stream.step       state machine -> LLMEvents            (real)
```

Replacing `httpClient` (already a `LayerNode` in `app-node-platform.ts`, already used by `simulationReplacements` mechanics) keeps the entire pipeline under test and gives wire-fidelity observation of what would have been sent to the provider. Failure injection (429s, malformed SSE, truncated streams) exercises real error paths that a typed `LLMClient` fake cannot reach.

## Components

### 1. Simulated network (`packages/simulation/src/backend/network.ts`)

Replaces `httpClient` in `simulationReplacements`. Each acquired network run owns its route table and bounded request log:

- `make(routes)` constructs one isolated client and log; routes are ordinary matchers supplied at acquisition.
- Unknown requests fail loudly with a typed simulation error (spec: deny unknown external network by default).
- Optional loopback allowance for the app's own server is not required server-side (the server does not call itself over HTTP); revisit if a consumer needs it.
- Every request summary is timestamped through Effect `Clock` and retained only for that run.

### 2. OpenAI endpoint route (`packages/simulation/src/backend/openai.ts`)

Registered in the network at startup for `POST {DEFAULT_BASE_URL}{PATH}` from `protocols/openai-chat.ts` (`https://api.openai.com/v1/chat/completions`).

On request:

1. Parse the real OpenAI request body, which remains available to the driver for assertions.
2. Call `SimulatedProvider.Service.stream({ url, body })`.
3. Encode the returned provider response events as SSE `data:` frames and terminate a finished response with `[DONE]`.

Chunks are constructed through the `OpenAIChatEvent` schema so drift in the protocol schema breaks the build, not the runtime.

The response stream is interruptible like a real HTTP response. If the runner cancels, the provider invocation is removed and later driver commands for its id fail.

### 3. Simulated provider (`packages/simulation/src/backend/simulated-provider.ts`)

The OpenAI route sees one Effect service:

```ts
interface SimulatedProvider {
  stream(request: ProviderRequest): Stream<ProviderResponseEvent, ProviderDisconnectedError>
}
```

`SimulatedProvider.layerDrive({ endpoint })` owns the Drive adapter in one Effect scope:

- Pending provider invocations and response queues.
- Late controller attachment and pending-invocation replay.
- The backend control WebSocket and its request fibers.
- Stream interruption, explicit disconnect, finish, and scope cleanup.

Invocation ids, queues, controller attachment, and WebSocket commands remain private to `layerDrive`. The OpenAI route only sees a provider request producing a response stream.

### 4. Backend control WebSocket (simulation-gated)

Started when `OPENCODE_DRIVE` names a registry manifest: a loopback JSON-RPC 2.0 WebSocket at that manifest's exact backend endpoint, hosted by the backend process. Drivers connect to it directly — the standalone topology has exactly one backend per TUI, so there is no proxying through the frontend. This socket is also the headless-simulation interface: it works with no TUI at all.

The backend and frontend control sockets share one scoped Effect adapter. It owns the Bun server, a bounded sequential message queue, its worker fiber, schema-based JSON decoding, and shutdown ordering.

Server -> driver notification (after `llm.attach`; pending invocations are replayed on attach so late-attaching drivers miss nothing):

```
{ "jsonrpc": "2.0", "method": "llm.request",
  "params": { "id": "inv_1", "url": "...", "body": { ...openai request body... } } }
```

Driver -> server methods:

```
llm.attach                                subscribe to llm.request notifications
llm.chunk   { id, items: Item[] }         append response items
llm.finish  { id, reason?: "stop" | ... } finish the invocation
llm.disconnect { id }                     fail the provider response stream
llm.pending                               list pending invocations
network.log                               simulated network request log
```

`Item` is the response vocabulary the driver speaks:

```
{ type: "textDelta",      text }
{ type: "reasoningDelta", text }
{ type: "toolCall",       id, name, input }
{ type: "raw",            chunk }        // escape hatch: raw OpenAIChatEvent JSON
```

The backend compiles items to OpenAI chunks (`delta.content`, `delta.tool_calls[].function.arguments`, `finish_reason`); `raw` passes through unmodified. Streaming granularity is the driver's choice: many small `llm.chunk` calls stream word by word; one call with many items plus `llm.finish` responds at once.

Failure injection (`llm.fail`: HTTP status instead of SSE) is specced but not yet implemented.

### 5. Driver topology

A driver manages two loopback WebSocket connections:

- TUI control server (manifest `endpoints.ui`) — UI state, actions, render, trace.
- Backend control server (manifest `endpoints.backend`) — simulated provider invocations. The network request log remains run-local diagnostic state.

Both speak the same JSON-RPC shape. Headless drivers use only the backend socket plus the normal HTTP API. Multiple drivers are out of scope; last attach wins.

### 6. Pacing and the clock

No server-side pacing exists. The driver controls timing by deciding when to send chunks.

### 7. Catalog and auth seeding

The driver-facing model must be selectable in the TUI. Simulation seeds config (via the snapshot filesystem) defining a provider on the openai-chat route with `baseURL` left at the OpenAI default and a dummy `apiKey` (satisfies `Catalog.available()`). No catalog code changes.

## End-to-end flow

```
driver                TUI drive server             backend + drive WS
  |                            |                          |
  |-- ui.action (submit) ----->|                          |
  |                            |-- (normal app HTTP) ---->|  session runner starts
  |                            |                          |  llm.stream -> HttpClient
  |                            |                          |  simulated network matches openai route
  |<================= llm.request {inv_1} ================|  provider invocation inv_1 opened
  |-- llm.chunk {inv_1,[...]} ===========================>|  SSE frames flow into the real
  |-- llm.chunk {inv_1,[...]} ===========================>|  decode -> step -> LLMEvents ->
  |-- llm.finish {inv_1} ================================>|  runner publishes, TUI renders
  |                            |                          |
  |   (if toolCall was sent: runner executes the real tool against the
  |    fake filesystem, then starts the next model invocation -> inv_2
  |    -> driver decides the next provider response)
```

The driver observes the TUI through `ui.state` while chunks stream, so mid-stream UI assertions need no clock control at all: the driver simply has not sent the rest yet.

## Implementation order

1. `network.ts`: simulated `HttpClient` + route table + deny-unknown + trace. Replace `httpClient` in `simulationReplacements`.
2. `simulated-provider.ts` + `openai.ts`: scoped Drive-controlled provider and the OpenAI SSE route (schema-constructed chunks, `[DONE]`, interruption).
3. `SimulatedProvider.layerDrive`: backend-hosted control WebSocket (`llm.attach|chunk|finish|disconnect|pending`), acquired only when `OPENCODE_DRIVE` is set.
4. Config seeding for the sim provider; end-to-end verification via `packages/server/script/e2e-sim.ts` (headless) and `packages/tui/script/sim-llm-driver.ts` (TUI + backend sockets).
5. Trace records for network and simulated provider activity.

## Consequences

- No enqueue/script store to keep consistent; the driver is the single source of model behavior.
- Deterministic tests write drivers that respond to `llm.request` programmatically instead of adding a second provider implementation.
- Provider-coupling is confined to `openai.ts` (one wire encoder against a schema that lives in the repo); a second simulated provider (e.g. Anthropic) is another route file if ever needed.
