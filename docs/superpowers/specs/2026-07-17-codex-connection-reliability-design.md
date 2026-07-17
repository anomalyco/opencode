# Codex Connection Reliability Design

**Date:** 2026-07-17

**Target:** `packages/opencode/src/plugin/openai` in `original-opencode`

**Reference:** `/home/dunghd/DEVELOPMENT/Research/9router-master`

## Objective

Improve ChatGPT Codex OAuth connection reliability without changing OpenCode's existing Responses protocol, terminal-event behavior, session semantics, account selection, or endpoint routing.

Transparent transport retries are allowed only before any upstream event is exposed to the existing parser/session layer. After an event is exposed, the existing OpenCode stream and session retry behavior remains authoritative.

## Included behavior

- HTTP response-header timeout: 60 seconds per attempt.
- HTTP inter-chunk stall timeout: 360 seconds, reset for each raw chunk.
- WebSocket connect timeout: 60 seconds.
- WebSocket idle/send timeout: 360 seconds.
- Pre-output retries for network/connect failures and HTTP 502, 503, and 504.
- Pre-output retry when the first parsed SSE event is a structured Codex overload error.
- One forced OAuth refresh and request reissue after HTTP 401.
- Preserve the existing refresh token when a refresh response omits a replacement.
- Abort-aware timeout and retry backoff.
- Focused tests for timing, SSE framing, cancellation, error preservation, terminal behavior, and tool-call uniqueness.

## Excluded behavior

- Account rotation, account cooldown, or quota-based account selection.
- Alternative endpoint or base-URL fallback.
- Model-combo fallback.
- Proxy-style request translation or broad body mutation.
- Synthetic `response.failed`, response IDs, or additional `[DONE]` frames.
- Changes to existing terminal-event handling.
- Transparent retry after any event has been exposed.
- Generic timeout changes for normal OpenAI API-key traffic.

## Reliability findings from 9Router

9Router's continuity comes from layered recovery:

1. It allows 60 seconds for upstream response headers.
2. It allows 360 seconds between raw stream chunks and resets the watchdog on upstream activity.
3. It retries transient network and 502/503/504 failures before returning a response downstream.
4. It detects Codex overload failures hidden in an HTTP 200 SSE response and retries at the beginning of the stream.
5. It supports proactive and reactive credential refresh.
6. It also uses account and endpoint failover, which are gateway responsibilities and are excluded from this OpenCode change.

9Router does not resume a stream after partial output. OpenCode will preserve the same safety boundary: retry before output, fail normally after output.

## Existing OpenCode behavior to preserve

- OpenAI provider HTTP header timeout currently defaults to 10 seconds.
- Codex WebSocket connection timeout currently defaults to 15 seconds.
- Codex WebSocket idle timeout currently defaults to 300 seconds.
- The WebSocket pool already owns session affinity, connection aging, busy-lane HTTP fallback, cancellation, cleanup, and sticky HTTP fallback after repeated socket failures.
- The Responses parser and WebSocket bridge already handle `response.completed`, `response.done`, `response.failed`, `response.incomplete`, and `[DONE]`.
- Session retry already handles retryable failures after transport errors reach the session layer.

The new timeouts apply only to ChatGPT OAuth/Codex traffic. They must not change ordinary OpenAI API-key behavior.

## Transport architecture

The Codex OAuth fetch boundary remains the integration point:

```text
request
  -> OAuth refresh/header construction
  -> Codex reliability transport
       -> connect/header timeout
       -> status/network retry
       -> first-SSE-event gate
       -> inter-chunk watchdog
  -> existing Responses parser
  -> existing session processing
```

The reliability transport must not own semantic parsing beyond identifying the first complete SSE event and a structured Codex error code. It must return accepted bytes unchanged.

## Retry policy

Retry counts are retries after the initial attempt.

| Failure | Retries | Delay |
|---|---:|---:|
| Network/connect failure | 3 | 3 seconds |
| HTTP 502 | 3 | 3 seconds |
| HTTP 503 | 3 | 2 seconds |
| HTTP 504 | 2 | 3 seconds |
| First SSE event: `server_is_overloaded` | 3 | 2 seconds |
| First SSE event: `service_unavailable_error` | 3 | 2 seconds |
| HTTP 401 | One forced refresh and one reissue | No delay |
| HTTP 403 | No transport retry | Preserve response |
| HTTP 429 | No transport retry | Preserve response and `Retry-After` |

Each status has an independent retry budget. Backoff must be cancellable; an aborted request must not start another attempt.

The transport must not retry when:

- a valid SSE event has already been returned to the caller;
- the overload text occurs in ordinary model output rather than a structured error event;
- the client has aborted;
- the relevant retry budget is exhausted.

## SSE first-event gate

The first-event gate must:

- support LF and CRLF SSE separators;
- support separators split across chunks;
- preserve raw bytes exactly;
- handle UTF-8 code points split across chunks;
- inspect only the first complete SSE event;
- reject a first event larger than 64 KiB as a bounded protocol error;
- recognize retryable codes only in structured error events;
- return immediately after accepting the first event instead of buffering the rest of the stream;
- expose only the final accepted attempt;
- preserve the final upstream error event when retries are exhausted.

Non-SSE and non-2xx responses retain their original status, body, and headers. A malformed 2xx streaming response is represented as a status-200 `Response` whose body stream fails with a typed stream error. Diagnostics must include its content type and a bounded body preview. Non-2xx responses are never rewritten this way.

## Timeout policy

### HTTP

- Header timeout: 60 seconds for each attempt.
- Inter-chunk timeout: 360 seconds after the response stream begins.
- The inter-chunk timer resets on each raw byte chunk, not translated output.
- Header and chunk timeouts combine with the caller's abort signal.

### WebSocket

- Connect timeout: 60 seconds.
- Idle/send timeout: 360 seconds.
- Existing pool retry/fallback and terminal behavior remain unchanged.

Timeout values are injectable through Codex plugin options for deterministic tests. Production defaults remain 60/360 seconds.

## OAuth recovery

The existing loader-local single-flight refresh remains the sole refresh owner.

- Normal requests refresh when local credentials have expired.
- An HTTP 401 forces one refresh and one request reissue.
- Concurrent callers share one in-flight refresh.
- A second 401 is returned without another refresh.
- A missing, empty, or malformed replacement refresh token must not erase the current valid refresh token.
- The reissued request retains the original method and body while rebuilding authorization/account headers from refreshed credentials.
- Abort before or during refresh prevents reissue.

HTTP 403 is not automatically refreshed because it can represent a real permission or account-scope failure.

## Terminal and session behavior

No terminal-event behavior changes are included. Existing OpenCode handling of completion, failure, incomplete responses, `response.done`, and `[DONE]` remains intact.

No transport retry occurs after partial output. Such failures continue through the existing stream error and session retry paths. This avoids duplicated text, reasoning, persisted events, and tool execution.

## Test strategy

Focused tests must prove:

1. Network, 502, 503, and 504 retries use the specified budgets and delays.
2. Abort during connect, first-event reading, or backoff prevents later attempts.
3. Codex HTTP and WebSocket defaults are 60/360 seconds through injectable test options.
4. Every raw chunk resets the inter-chunk watchdog.
5. LF, CRLF, split separators, and split UTF-8 are handled correctly.
6. Structured overload first events retry; matching text content does not.
7. An accepted first event is replayed byte-for-byte exactly once.
8. The accepted stream is returned without buffering its remainder.
9. Exhausted retries expose only the final accepted error stream.
10. HTTP 401 refreshes and reissues once; concurrent requests use one refresh.
11. HTTP 403 and 429 preserve status, body, and headers.
12. Omitted refresh-token rotation preserves the previous token.
13. Existing terminal-event tests remain unchanged and pass.
14. Tool calls are emitted and executed only once.

Run targeted plugin tests and package typecheck from `packages/opencode`, then inspect the final diff. If protocol code is unchanged, the existing protocol suite is a regression check rather than an implementation target.

## Documentation deliverable

Write a Vietnamese engineering report under `/home/dunghd/DEVELOPMENT/Research/docs/` containing:

- 9Router's complete Codex request lifecycle;
- exact 60/360-second timeout behavior;
- status/network/SSE retry layers;
- OAuth refresh and account failover mechanisms;
- stream parsing and terminal handling;
- mechanisms adopted by OpenCode;
- mechanisms deliberately rejected and why;
- changed OpenCode files and verification evidence.

## Success criteria

- Slow Codex connection establishment is not aborted at OpenCode's previous 10/15-second thresholds.
- A healthy but temporarily quiet stream may remain idle for up to 360 seconds between raw chunks.
- Transient pre-output network, gateway, and structured overload failures recover transparently within bounded retry budgets.
- Authentication can recover once from server-side token invalidation without losing the refresh token.
- Cancellation remains immediate.
- Existing terminal semantics and session behavior do not change.
- No retry path can duplicate visible output or tool execution.
