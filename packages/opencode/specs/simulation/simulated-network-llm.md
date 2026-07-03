# Simulated Network And Driver-Scripted LLM

Status: design for the Phase 2 network and LLM items in `simulation-phases.md`.

## Summary

Simulation replaces the `HttpClient.HttpClient` platform node with a simulated network. The LLM is not a separate fake: it is one registered route in that network (`api.openai.com`), answered by the **external driver** over the existing control WebSocket. When the app issues a provider request, the backend forwards it to the driver and the driver streams response chunks back. There is no enqueueing and no scripted-response store; the driver is the model.

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

Replaces `httpClient` in `simulationReplacements`. An in-memory route table:

- `register(matcher, responder)` where matcher is method + URL pattern and responder is `(HttpClientRequest) => Effect<HttpClientResponse>`.
- Unknown requests fail loudly with a typed simulation error (spec: deny unknown external network by default).
- Optional loopback allowance for the app's own server is not required server-side (the server does not call itself over HTTP); revisit if a consumer needs it.
- Every request/response summary is traced.

### 2. OpenAI endpoint route (`packages/simulation/src/backend/openai.ts`)

Registered in the network at startup for `POST {DEFAULT_BASE_URL}{PATH}` from `protocols/openai-chat.ts` (`https://api.openai.com/v1/chat/completions`).

On request:

1. Allocate an exchange id. Parse the real OpenAI request body (available to the driver for assertions).
2. Publish a `request` record to the LLM exchange service (below) and create a chunk `Queue`.
3. Return `HttpClientResponse` with `content-type: text/event-stream` whose body stream reads from the queue, encoding each item as an SSE `data:` frame, terminated by `[DONE]`.

Chunks are constructed through the `OpenAIChatEvent` schema so drift in the protocol schema breaks the build, not the runtime.

The response stream is interruptible like a real HTTP response: if the runner cancels (user interrupt), the exchange closes and the driver is notified.

### 3. LLM exchange service (`packages/simulation/src/backend/llm-exchange.ts`)

Process-global simulation service owning pending exchanges:

```
Exchange = { id, body, queue: Queue<Item | Error | Done>, deferred lifecycle }
```

- `requests()` — stream of newly opened exchanges (consumed by the control route).
- `push(id, item)` — append one response item to an open exchange.
- `finish(id, reason)` / `fail(id, failure)` — terminate the exchange.
- Exchanges that receive no driver within a configurable timeout fail the provider request with a simulation error (surfaces in the real provider-error path).

### 4. Backend control WebSocket (simulation-gated)

Started when the simulation module loads (lazy import, `OPENCODE_SIMULATION` only): a loopback JSON-RPC 2.0 WebSocket on `127.0.0.1:40950+`, hosted by the backend process. Drivers connect to it directly — the standalone topology has exactly one backend per TUI, so there is no proxying through the frontend. This socket is also the headless-simulation interface: it works with no TUI at all.

Server -> driver notification (after `llm.attach`; pending exchanges are replayed on attach so late-attaching drivers miss nothing):

```
{ "jsonrpc": "2.0", "method": "llm.request",
  "params": { "id": "ex_1", "url": "...", "body": { ...openai request body... } } }
```

Driver -> server methods:

```
llm.attach                                subscribe to llm.request notifications
llm.chunk   { id, items: Item[] }         append response items
llm.finish  { id, reason?: "stop" | ... } finish the exchange
llm.pending                               list open exchanges
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

- TUI control server (`127.0.0.1:40900+`) — UI state, actions, render, trace.
- Backend control server (`127.0.0.1:40950+`) — LLM exchanges, network log.

Both speak the same JSON-RPC shape. Headless drivers use only the backend socket plus the normal HTTP API. Multiple drivers are out of scope; last attach wins.

### 6. Pacing and the clock

No server-side pacing by default: the driver controls timing by when it sends chunks, which is the point of driver-in-the-loop. A convenience `llm.chunk` option `{ delayMs }` may sleep via `Effect.sleep` between items server-side; because that uses the fiber `Clock`, scoping a controllable clock to the exchange stream (`Stream.provideService(Clock.Clock, simClock)`) remains available for deterministic replay without touching app time. Defer until replay work needs it.

### 7. Catalog and auth seeding

The driver-facing model must be selectable in the TUI. Simulation seeds config (via the snapshot filesystem) defining a provider on the openai-chat route with `baseURL` left at the OpenAI default and a dummy `apiKey` (satisfies `Catalog.available()`). No catalog code changes.

## End-to-end flow

```
driver                TUI sim server (40900+)     backend + control WS (40950+)
  |                            |                          |
  |-- ui.action (submit) ----->|                          |
  |                            |-- (normal app HTTP) ---->|  session runner starts
  |                            |                          |  llm.stream -> HttpClient
  |                            |                          |  simulated network matches openai route
  |<================== llm.request {ex_1} ===============|  exchange ex_1 opened
  |-- llm.chunk {ex_1,[...]} ============================>|  SSE frames flow into the real
  |-- llm.chunk {ex_1,[...]} ============================>|  decode -> step -> LLMEvents ->
  |-- llm.finish {ex_1} =================================>|  runner publishes, TUI renders
  |                            |                          |
  |   (if toolCall was sent: runner executes the real tool against the
  |    fake filesystem, then issues the next provider turn -> new exchange
  |    ex_2 -> driver decides the next response)
```

The driver observes the TUI through `ui.state` while chunks stream, so mid-stream UI assertions need no clock control at all: the driver simply has not sent the rest yet.

## Implementation order

1. `network.ts`: simulated `HttpClient` + route table + deny-unknown + trace. Replace `httpClient` in `simulationReplacements`.
2. `llm-exchange.ts` + `openai.ts`: exchange service and the OpenAI SSE route (schema-constructed chunks, `[DONE]`, interruption).
3. `control.ts`: backend-hosted control WebSocket (`llm.attach|chunk|finish|pending`, `network.log`), started when the simulation module loads.
4. Config seeding for the sim provider; end-to-end verification via `packages/server/script/e2e-sim.ts` (headless) and `packages/tui/script/sim-llm-driver.ts` (TUI + backend sockets).
5. Trace records for network and LLM exchange activity.

## Consequences

- No enqueue/script store to keep consistent; the driver is the single source of model behavior.
- Deterministic tests write drivers (respond to `llm.request` programmatically) instead of pre-baked scripts; replay (Phase 4) records exchanges and replays them as an automatic driver.
- Provider-coupling is confined to `openai.ts` (one wire encoder against a schema that lives in the repo); a second simulated provider (e.g. Anthropic) is another route file if ever needed.
