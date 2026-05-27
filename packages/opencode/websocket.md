# Responses WebSocket Parity Specification

## Goal

Implement **Responses API over WebSocket** in OpenCode, matching the upstream inference transport behavior used by Codex.

This scope covers model response streaming only. It does not include realtime audio, an inbound app-server WebSocket server, remote-control transports, exec transports, or generic JSON-RPC over WebSocket.

The application layer should consume the same response events regardless of whether they arrive through existing HTTP/SSE transport or the new WebSocket transport.

WebSocket mode is intended for long-running, tool-call-heavy workflows. Its main benefit is keeping a connection open while sending only incremental input items for later turns. OpenAI reports latency improvements of up to roughly 40% in rollouts with 20 or more tool calls.

WebSocket mode is compatible with `store=false` and Zero Data Retention (ZDR), subject to the continuation and reconnect behavior described below.

## Codex References

- `codex-rs/codex-api/src/endpoint/responses_websocket.rs`
- `codex-rs/codex-api/src/common.rs`
- `codex-rs/core/src/client.rs`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/tests/suite/client_websockets.rs`
- `codex-rs/core/tests/suite/websocket_fallback.rs`

Official protocol reference reviewed for this specification: OpenAI Responses API WebSocket Mode documentation.

## What Codex Actually Does Today

The following behavior is implemented in the inspected Codex code and is the parity baseline for OpenCode.

### `store` Value

Codex constructs both HTTP and WebSocket Responses requests with:

```rust
store: provider.is_azure_responses_endpoint()
```

Therefore:

| Provider path | Codex `store` value |
| --- | --- |
| Normal OpenAI / ChatGPT Codex Responses path | `false` |
| Azure Responses endpoint | `true` |

The ordinary Codex WebSocket path is consequently designed around `store: false` continuation over a live connection.

### Full Input Versus `previous_response_id`

Codex does not always send full chat history and does not always send `previous_response_id`.

| Situation | Codex request behavior |
| --- | --- |
| First request in a response chain | Sends full currently assembled input; no `previous_response_id`. |
| Successful compatible next request on the healthy reused socket | Sends only new input items with `previous_response_id` set to the last completed response ID. |
| Compatible next turn while the same socket and continuation state remain reusable | Also uses incremental input with `previous_response_id`. |
| Startup prewarm completed and the real request is compatible | May continue from the warmup response ID with incremental input. |
| No completed prior response exists | Sends full input without `previous_response_id`. |
| Connection is replaced or reset after failure | Clears continuation state and sends full input on the new socket. |
| Prior request failed | Clears continuation state and sends full input on the next connection/request. |
| New request is not a prefix extension of the prior logical context | Sends full input without `previous_response_id`. |
| Non-input fields changed, such as instructions or service tier | Sends full input without `previous_response_id`. |

Codex determines whether incremental continuation is safe by comparing the new request to the previous request, excluding `input`, and then checking whether the new input extends the previous input plus output items returned by the completed response.

### Codex Versus Official Protocol Requirements

This specification includes a small number of requirements from OpenAI's official WebSocket documentation that are not clearly implemented in the inspected Codex path:

| Behavior | Codex inspected implementation | This specification |
| --- | --- | --- |
| `stream` in `response.create` | Codex currently serializes its HTTP-derived `stream` field. | Follow official docs: do not rely on WebSocket `stream` or `background` fields. |
| `previous_response_not_found` recovery | No explicit full-context recovery branch was identified; a `400` error is generally surfaced as an invalid request. | Clear continuation state and retry as a new full-context response. |
| `store=false`/ZDR reconnect recovery | Codex clears continuation state after recognized socket failure and then naturally sends full input. | Make this an explicit required behavior and cover it with tests. |

This means the document is intended to deliver Codex parity where Codex has concrete behavior, while adopting official protocol behavior where it closes a correctness gap or clarifies the server contract.

## Parity Target

### Required For Codex Default Runtime Parity

- Persistent Responses WebSocket transport behind provider capability.
- Ordinary OpenAI/ChatGPT requests use `store: false`; Azure Responses requests use `store: true` if OpenCode supports that provider behavior.
- One active response stream per socket, with the physical socket reused across sequential requests and across logical turns.
- Incremental `previous_response_id` requests when continuation is safe, including across turns and after successful prewarm.
- Full-context requests whenever continuation cannot be proven safe or socket state has been replaced after failure.
- Startup `response.create` prewarm with `generate: false`, completed before the first generated request when startup prewarm is scheduled.
- WebSocket stream retry behavior and session-sticky HTTP/SSE fallback.
- Handshake metadata propagation and per-turn sticky routing behavior described below.
- Connection-limit reconnect, structured API errors, ping/pong, timeouts, and transport telemetry.

### Feature-Complete Or Diagnostic Parity

- Connection-only `preconnect_websocket()` support, separate from request prewarm.
- Feature-gated `response.processed` acknowledgement after successfully processing a completed response.
- Handshake-only health probe that reports immediate post-upgrade close behavior.

### Official-Protocol Correctness Beyond Observed Codex Behavior

- Do not depend on HTTP-only `stream` or `background` fields in WebSocket requests.
- Recover from `previous_response_not_found` by retrying from full current context without continuation state.
- Explicitly test `store=false`/ZDR recovery after live connection-local state is lost.

## Required Behavior

### Transport Selection

- Add provider-level capability such as `supports_websockets`.
- Use WebSocket only when the provider supports it and the current session has not fallen back to HTTP.
- Keep HTTP/SSE as the fallback transport.
- Once fallback occurs for a session, keep later turns on HTTP/SSE rather than repeatedly retrying WebSocket.
- Treat fallback state as session-scoped, not request-scoped or turn-scoped.

### Endpoint And Handshake

- Derive the WebSocket endpoint from the configured Responses HTTP endpoint.
- Convert `http` to `ws` and `https` to `wss`.
- Send the same authentication and provider headers used by HTTP requests.
- Preserve custom TLS/CA behavior used by HTTPS requests.
- Include the OpenAI Responses WebSocket protocol header:

```text
OpenAI-Beta: responses_websockets=2026-02-06
```

- Add a configurable WebSocket connect timeout.
- Capture and propagate the handshake response metadata Codex handles when the upstream server provides it:

| Handshake response header | Codex behavior |
| --- | --- |
| `x-reasoning-included` | Emits server reasoning-included state before response events. |
| `x-models-etag` | Emits the returned models ETag before response events. |
| `openai-model` | Emits the server-selected model before response events. |
| `x-codex-turn-state` | Stores a sticky routing token for subsequent requests or reconnects in the same turn. |

### Sticky Turn Routing

Codex maintains turn routing state independently of physical socket reuse:

- Capture `x-codex-turn-state` from the WebSocket upgrade response when provided.
- Replay it in `x-codex-turn-state` on later connection handshakes made within the same logical turn, including reconnect attempts.
- Preserve it unchanged throughout one turn.
- Never replay a previous turn's token into a new turn, even if the physical WebSocket connection or continuation state is reused across turns.
- Keep request-scoped metadata and tracing on each `response.create` payload so socket reuse does not freeze metadata from the connection's original turn.

### Request Protocol

Send JSON text frames of type `response.create`. The payload mirrors the normal Responses create body, except that WebSocket mode does not use transport-specific request fields such as `stream` or `background`.

The inspected Codex implementation currently serializes its HTTP-derived `stream` field into `response.create`; OpenAI's protocol documentation states that `stream` is not used in WebSocket mode. OpenCode should implement against the documented protocol and avoid depending on `stream` being accepted.

Example:

```json
{
  "type": "response.create",
  "model": "gpt-...",
  "store": false,
  "input": [],
  "tools": []
}
```

### Response Protocol

- Read JSON text frames from the socket.
- Feed ordinary Responses events through the same event parsing and application pipeline currently used for SSE.
- Treat a request as successful only after `response.completed`.
- Surface `response.failed` and structured error frames through existing application error handling.
- Reject unexpected binary response frames for this protocol.
- Reply to incoming WebSocket Ping frames with matching Pong frames.

### Connection Lifecycle

- Reuse a healthy WebSocket across sequential requests.
- Reuse a healthy physical WebSocket across logical turns by returning it to session-level cached state after each turn and taking it for the next turn.
- Reset per-turn sticky routing state when beginning each new turn, even when reusing the physical socket.
- Support one active response stream per socket initially.
- Do not multiplex multiple concurrent model generations over one socket.
- Use multiple WebSocket connections when parallel response runs are required.
- Expect a maximum connection duration of 60 minutes and reconnect when it is reached.
- Add idle timeouts for sending request frames and waiting for response events.
- Open a fresh socket after a failed or invalidated connection.

A socket must not be reused after:

- send failure
- receive failure
- send or receive idle timeout
- server close before `response.completed`
- unexpected binary response frame
- terminal response failure
- malformed protocol state where request completion is ambiguous

### Retry And Fallback

- Retry retryable WebSocket failures using the existing stream retry policy.
- Use a new socket for retries after the prior socket has failed.
- If the WebSocket handshake returns HTTP `426`, switch immediately to HTTP/SSE and replay the request there.
- If retryable WebSocket failures exhaust the retry budget, switch to HTTP/SSE and replay the request there.
- Keep fallback sticky for the remainder of the session.
- Suppress noisy first transient WebSocket reconnect messaging in normal release UX if matching Codex user-visible behavior; later retry/fallback messaging must explain what happened.

### Continuation And Data Retention

Incremental continuation is part of the useful WebSocket mode behavior, not merely a transport optimization. After a successfully completed response, the next request should be able to send only new input items with the prior response ID:

```json
{
  "type": "response.create",
  "model": "gpt-...",
  "store": false,
  "previous_response_id": "resp_123",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "call_123",
      "output": "tool result"
    }
  ],
  "tools": []
}
```

The server retains one previous-response state in memory on an active WebSocket connection: the most recent response. Continuing from that response is the low-latency path.

Only send incremental input with `previous_response_id` when:

- the prior response completed successfully
- a prior response ID exists
- the current socket still has a valid continuation path, or persisted response state may be used
- the new request logically extends the previous conversation
- non-input fields such as model settings, tools, instructions, and service tier have not changed

Recovery rules:

- With `store=true`, reconnecting may continue from a persisted prior response ID, but it can lose the connection-local latency benefit.
- With `store=false`, including ZDR, there is no persisted fallback after the in-memory continuation is lost. After reconnect or cache miss, send full input context as a new chain without `previous_response_id`.
- If a continuation turn returns a `4xx` or `5xx` error, assume the referenced previous-response state has been evicted and do not reuse it on the next request.
- Never preserve continuation state after an ambiguous or failed stream.

### Compaction

- With server-side compaction configured through `context_management`, continue using the latest `previous_response_id` and only new input items as usual.
- The standalone `/responses/compact` endpoint returns a compacted input window, not a response ID.
- After standalone compaction, start a new WebSocket response chain without `previous_response_id` and provide the returned compacted window as the base `input`, followed by new user or tool items.
- Pass standalone compacted output through as returned; do not prune the compacted window in the transport layer.

### Structured Error Frames

Support error messages delivered as WebSocket text events, for example:

```json
{
  "type": "error",
  "status": 429,
  "error": {
    "type": "usage_limit_reached",
    "message": "The usage limit has been reached"
  },
  "headers": {}
}
```

Preserve equivalent existing HTTP/SSE behavior for:

- invalid requests
- authentication failures
- rate limits and quota errors
- policy errors
- server failures

Special-case `websocket_connection_limit_reached` as retryable. When received:

- discard the expired socket
- open a new socket
- retry the request
- do not permanently fall back to SSE solely because the old socket reached its server-enforced lifetime

Handle `previous_response_not_found` as continuation-state loss:

```json
{
  "type": "error",
  "status": 400,
  "error": {
    "code": "previous_response_not_found",
    "message": "Previous response with id 'resp_abc' not found.",
    "param": "previous_response_id"
  }
}
```

- Clear the cached continuation state.
- With `store=false`/ZDR, retry by creating a new response with full current input context and no `previous_response_id`.
- With `store=true`, if the server has already rejected that ID as unavailable, likewise retry as a new full-context response rather than repeatedly submitting the unavailable ID.

### Observability And Diagnostics

- Record WebSocket connect duration.
- Record request send duration and response event wait duration.
- Record whether a connection was new or reused.
- Record reconnect attempts and HTTP fallback reason.
- Record enough auth/request context on handshake attempts to diagnose unauthorized recovery and transport routing without exposing credentials.
- Provide enough logs or diagnostic surface to distinguish handshake failure, timeout, immediate close, stream failure, and HTTP fallback.

## Codex Startup Optimization Requirements

Startup prewarm is required for Codex default runtime parity. Connection-only preconnect and diagnostics are feature-complete parity items that may be implemented after the main transport is correct.

### Preconnect

Codex supports opening the WebSocket before the first user-visible request without sending inference data. Implement this for feature-complete parity. It must not replace or incorrectly reuse the per-request tracing or metadata of the subsequent real request.

### Prewarm

Implement Codex-style startup request prewarming for default runtime parity:

```json
{
  "type": "response.create",
  "generate": false
}
```

Prewarm opens/reuses the socket, sends the warmup request, and waits for `response.completed` before sending the first generated request. It does not itself represent a model-generation inference attempt in rollout tracing.

If the first real request is compatible with the completed warmup request, send only its incremental delta with the warmup response ID as `previous_response_id`. If request properties have changed, send a normal full-context request without reusing the warmup response ID.

If prewarm fails, normal retry/fallback handling must recover; prewarm is counted as an initial WebSocket transport attempt rather than bypassing transport failure policy.

The response ID returned by a successful `generate: false` warmup may be used as `previous_response_id`, including by later requests in the response chain.

### Completion Acknowledgement

For feature-complete parity, support Codex's feature-gated acknowledgement:

```json
{
  "type": "response.processed",
  "response_id": "resp_123"
}
```

If implemented, acknowledgement failure must not turn an already completed model response into a failed user request.

### Handshake Probe

For diagnostic parity, add a check that performs the same authenticated WebSocket handshake as a real request, without sending model input. It should distinguish successful upgrade, handshake timeout, immediate server close, TLS/custom CA failure, and policy/proxy rejection.

## OpenCode Integration Work

Before writing transport code, the implementation agent must locate and map these existing OpenCode responsibilities:

| OpenCode area to locate | Integration needed |
| --- | --- |
| Existing Responses HTTP/SSE request builder | Reuse request semantics while emitting WebSocket `response.create` payloads. |
| Existing SSE event parser and error mapping | Share the same application-level event and error surface with WebSocket. |
| Provider configuration/capability layer | Add WebSocket support, connect timeout, and any applicable endpoint/provider exclusions. |
| Session/turn ownership | Hold the reusable socket at session scope while preventing turn-routing metadata leakage. |
| Existing retry/backoff and cancellation handling | Apply retry classification and sticky fallback consistently. |
| Existing compaction flow | Reset or continue chains according to standalone versus server-side compaction rules. |
| Telemetry/logging/test harnesses | Add WebSocket connect/send/event/reuse/fallback coverage. |

The implementation should extend these boundaries rather than building a second independent model-event pipeline.

## Suggested State Model

| State | Meaning |
| --- | --- |
| `disabled` | Provider does not support WebSocket. |
| `disconnected` | WebSocket is permitted but no socket exists. |
| `connecting` | Handshake is in progress. |
| `idle` | Healthy socket is available for a request. |
| `streaming` | One active response is using the socket. |
| `failed` | Socket must be discarded before further work. |
| `fallback_http` | This session uses HTTP/SSE permanently. |

Important transitions:

| From | Event | To | Action |
| --- | --- | --- | --- |
| `disconnected` | WebSocket-enabled request | `connecting` | Start handshake. |
| `connecting` | Upgrade succeeds | `idle` | Store usable socket. |
| `connecting` | HTTP `426` | `fallback_http` | Replay via SSE. |
| `connecting` | Retryable failure | `disconnected` | Retry within budget. |
| `connecting` | Retry budget exhausted | `fallback_http` | Replay via SSE. |
| `idle` | Start request | `streaming` | Send `response.create`. |
| `streaming` | `response.completed` | `idle` | Preserve safe continuation state. |
| `streaming` | `previous_response_not_found` | `failed` | Clear continuation; retry using full context. |
| `streaming` | `websocket_connection_limit_reached` | `failed` | Reconnect; continue only when prior state remains recoverable. |
| `streaming` | Timeout, close, transport failure, or terminal failure | `failed` | Destroy socket and classify retry. |
| `failed` | Retry permitted | `connecting` | Open replacement socket. |
| `failed` | Retry budget exhausted | `fallback_http` | Replay via SSE. |

## Required Tests

1. Basic WebSocket request streams normal Responses events to completion.
2. Provider without WebSocket support continues using SSE.
3. HTTP and HTTPS endpoints convert correctly to WS and WSS.
4. Handshake sends authentication and protocol headers.
5. Custom TLS/CA behavior matches the existing HTTPS transport.
6. WebSocket connect timeout is enforced.
7. Incoming Ping receives Pong.
8. Two sequential successful requests reuse one healthy socket.
9. Two compatible sequential turns reuse one healthy socket and send incremental input with `previous_response_id`.
10. Reusing a physical socket across turns does not replay the previous turn's sticky routing token.
11. Reconnects within one turn replay that turn's sticky routing token.
12. Handshake metadata for model, models ETag, and reasoning inclusion is propagated through the existing event surface.
13. Only one active response stream is allowed per socket.
14. Early socket close before `response.completed` fails the request and invalidates the socket.
15. Idle timeout fails the request and invalidates the socket.
16. Failed socket is not reused for a later request.
17. HTTP `426` immediately falls back to SSE.
18. Exhausted WebSocket retries fall back to SSE.
19. SSE fallback remains active for later turns in the same session.
20. Invalid-request error frames map to existing invalid-request behavior.
21. Rate-limit and quota frames preserve existing structured error handling.
22. `websocket_connection_limit_reached` reconnects with a new socket and retries successfully.
23. Connections are rotated or recovered when the server-enforced 60-minute limit is reached.
24. Terminal response errors are surfaced without waiting for graceful socket close.
25. Incremental continuation sends only new inputs with `previous_response_id` when safe.
26. Changes to non-input request fields force a full `response.create` without continuation state.
27. `store=false`/ZDR recovery after connection loss sends full input context without `previous_response_id`.
28. `previous_response_not_found` clears continuation state and retries using full context.
29. Failed continuation requests do not reuse their referenced previous-response state.
30. Standalone compacted input starts a new chain without `previous_response_id`.
31. WebSocket `response.create` requests do not rely on HTTP-only `stream` or `background` fields.
32. Startup `generate: false` prewarm waits for completion and safely reuses its response ID when compatible.
33. Failed startup prewarm enters ordinary retry/fallback behavior.
34. Preconnect preserves request-specific trace and metadata when implemented.
35. `response.processed` acknowledgement is gated and non-fatal when implemented.
36. Handshake probe distinguishes upgrade success from immediate close when implemented.

## Non-Goals

- Inbound WebSocket server support for OpenCode clients.
- JSON-RPC over WebSocket.
- Realtime audio or WebRTC transport.
- Remote-control relay protocols.
- Durable message acknowledgement or replay buffers.
- Multiple concurrent model generations multiplexed over one socket.

## Definition Of Done

OpenCode can use a persistent WebSocket connection for ordinary Responses streaming; ordinary OpenAI/ChatGPT operation uses `store: false`; successful compatible requests continue incrementally using `previous_response_id`; compatible turns and startup prewarm reuse a healthy socket; failed or incompatible chains send full context; per-turn routing metadata never leaks between turns; the application sees the same event surface as SSE; and the transport safely retries or falls back without reusing invalid or ambiguous connection state.
