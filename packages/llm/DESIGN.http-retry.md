# LLM HTTP Diagnostics And Retry Plan

## Goal

Improve provider HTTP failures so they are easier to debug, safer to report, and retryable only at boundaries that do not replay a partially consumed model stream.

The first implementation should prioritize diagnostics and conservative rate-limit / overload retries. Transport retries for generation `POST`s are ambiguous because a timeout or connection reset does not prove the provider did not receive and process the request.

## Current State

`src/route/executor.ts` centralizes provider HTTP execution through `RequestExecutor.Service`:

```ts
execute: (request) => http.execute(request).pipe(Effect.mapError(toHttpError), Effect.flatMap(statusError))
```

Current typed failures are intentionally small:

- `ProviderRequestError`: HTTP status, message, optional body.
- `TransportError`: message, optional reason, optional URL.

This is enough for coarse handling, but weak for production debugging and retry decisions. A failed request does not carry redacted request headers, response headers, provider request IDs, retry hints, or parsed `Retry-After` timing.

## Non-Goals

- Do not retry after any response stream element has been returned to an route parser.
- Do not retry provider chunk parse errors or mid-stream provider error events.
- Do not add provider-specific error classes in the first pass.
- Do not parse every provider error body into provider-native shapes in the executor.
- Do not add broad replay semantics for tool loops, provider-executed tools, or partial generations.
- Do not expose secrets in error values, logs, snapshots, or tests.

## Design

### 1. Add HTTP Diagnostic Shapes

Add reusable schema classes in `src/schema.ts`:

```ts
export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>("LLM.HttpRequestDetails")({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>("LLM.HttpResponseDetails")({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}
```

Extend `ProviderRequestError`:

```ts
export class ProviderRequestError extends Schema.TaggedErrorClass<ProviderRequestError>()("LLM.ProviderRequestError", {
  status: Schema.Number,
  message: Schema.String,
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  retryable: Schema.optional(Schema.Boolean),
  retryAfterMs: Schema.optional(Schema.Number),
  requestId: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  request: Schema.optional(HttpRequestDetails),
  response: Schema.optional(HttpResponseDetails),
}) {}
```

Extend `TransportError` for diagnostics, but do not make transport retry automatic in the first patch:

```ts
export class TransportError extends Schema.TaggedErrorClass<TransportError>()("LLM.TransportError", {
  message: Schema.String,
  reason: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  retryable: Schema.optional(Schema.Boolean),
  request: Schema.optional(HttpRequestDetails),
}) {}
```

Add a small normalized rate-limit shape if it remains simple:

```ts
export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>("LLM.HttpRateLimitDetails")({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.String),
  remaining: Schema.optional(Schema.String),
  reset: Schema.optional(Schema.String),
}) {}
```

If `HttpRateLimitDetails` starts becoming provider-specific, skip it in the first patch and rely on redacted response headers plus `retryAfterMs`.

### 2. Redact Headers, URLs, And Bodies

Redaction must happen before typed errors are constructed.

Prefer Effect's redaction context if it is convenient from `effect/unstable/http`:

- Extend `Headers.CurrentRedactedNames` with package-sensitive names.
- Use the equivalent of `Redactable.redact(...)` for request and response headers.

Keep a local matcher for URL query parameters and as a fallback policy:

```ts
const sensitiveName = (name: string) =>
  /authorization|api[-_]?key|token|secret|credential|signature|x-amz-signature/i.test(name)
```

Header redaction:

```ts
const redactHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, sensitiveName(name) ? "<redacted>" : value]))
```

URL redaction:

```ts
const redactUrl = (value: string) => {
  const url = new URL(value)
  url.searchParams.forEach((_, key) => {
    if (sensitiveName(key)) url.searchParams.set(key, "<redacted>")
  })
  return url.toString()
}
```

Response body handling:

- Cap stored bodies, for example at `16_384` characters.
- Set `bodyTruncated: true` when capped.
- Do not attempt deep provider-specific body redaction in the first pass unless a known secret field is easy to scrub safely.
- Consider reusing the HTTP recorder's secret scanning helpers if they are package-accessible without making `llm` tests depend on recorder internals.

### 3. Extract Request, Response, And Provider Request IDs

`statusError` must receive the original request. The current shape `statusError(response)` cannot populate request diagnostics reliably.

Use a closure:

```ts
const statusError =
  (request: HttpClientRequest.HttpClientRequest) => (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      if (response.status < 400) return response
      // construct ProviderRequestError with request + response diagnostics
    })
```

Or switch to `HttpClient.filterStatusOk` and map the resulting `StatusCodeError`, which carries both request and response. The closure approach is the smaller change against the current executor.

Normalize headers once for case-insensitive lookups:

```ts
const normalizedHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
```

Request ID extraction should be conservative and provider-agnostic:

```ts
const requestId = (headers: Record<string, string>) => {
  const normalized = normalizedHeaders(headers)
  return (
    normalized["x-request-id"] ??
    normalized["request-id"] ??
    normalized["x-amzn-requestid"] ??
    normalized["x-amz-request-id"] ??
    normalized["x-goog-request-id"] ??
    normalized["cf-ray"]
  )
}
```

This is diagnostic only; routes can still expose richer provider metadata later.

### 4. Classify Retryable Status Responses Conservatively

Automatic retry should initially apply only to explicit HTTP status responses where no model stream was handed to a parser.

Default automatic retry statuses:

- `429 Too Many Requests`
- `503 Service Unavailable`
- `504 Gateway Timeout`
- `529 Overloaded` used by Anthropic-style overload responses

Do not include `409` in provider-neutral defaults. Effect-smol treats OpenAI `409` as invalid request-like behavior, and there is not enough provider evidence to retry it globally.

Do not automatically retry transport timeouts / connection resets in the first patch. Marking them as diagnostically retryable can be considered later behind explicit opt-in, but default generation retries should not replay ambiguous `POST`s.

Implementation helper:

```ts
const retryableStatus = (status: number) => status === 429 || status === 503 || status === 504 || status === 529
```

Potential future additions after provider evidence:

- `500`, `502` for transient provider failures.
- Cloudflare edge statuses such as `520`, `522`, `524` for OpenAI-compatible front doors.
- Provider-specific policies keyed by route/provider.

### 5. Parse `Retry-After` And Simple Rate-Limit Headers

Parse standard `Retry-After` forms:

- Delta seconds: `Retry-After: 3`
- HTTP date: `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`

Also accept `retry-after-ms` when present.

```ts
const retryAfterMs = (headers: Record<string, string>) => {
  const normalized = normalizedHeaders(headers)
  const millis = Number(normalized["retry-after-ms"])
  if (Number.isFinite(millis)) return Math.max(0, millis)

  const value = normalized["retry-after"]
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())

  return undefined
}
```

Keep raw redacted headers on `HttpResponseDetails` so callers can inspect provider-specific rate-limit headers such as `x-ratelimit-*`, `anthropic-ratelimit-*`, or AWS/Gemini equivalents without the executor knowing every provider shape.

### 6. Add Conservative Pre-Stream Retry In `RequestExecutor`

Retry should live in `src/route/executor.ts`, not in each route.

The executor owns this boundary:

```txt
compile request -> execute HTTP request -> receive response -> parse stream
```

Automatic retry is allowed only before `execute` returns a successful response. After that, stream consumers own the response and retrying could duplicate text, tool calls, hosted tool side effects, or token charges.

Default retry policy:

- `maxRetries`: `2`
- Base delay: `500ms`
- Max delay: `10s`
- Jitter: enabled when no `retryAfterMs` is present
- Honor `retryAfterMs` when present, capped by max delay in the first patch
- Retry predicate: only `ProviderRequestError` with `retryable === true`

Use Effect scheduling primitives if the v4 API can express error-dependent delay cleanly. If not, keep a small private helper rather than exposing retry machinery publicly.

The shape should be similar to:

```ts
const executeOnce = (request: HttpClientRequest.HttpClientRequest) =>
  http.execute(request).pipe(Effect.mapError(toHttpError), Effect.flatMap(statusError(request)))

execute: (request) => executeOnce(request).pipe(retryStatusFailures(defaultRetryPolicy))
```

`retryStatusFailures` should stay private until there is a concrete external need.

### 7. Future Retry Configuration Requires Executor Context

Do not add `HttpOptions.retry` in the first patch.

`RequestExecutor.execute` currently receives only `HttpClientRequest.HttpClientRequest`. It does not receive the original `LLMRequest`, merged model/request `HttpOptions`, route ID, provider ID, or generation/tool context.

Per-request retry configuration requires one of these changes first:

```ts
execute: (input: { readonly http: HttpClientRequest.HttpClientRequest; readonly request: LLMRequest }) =>
  Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
```

or:

```ts
execute: (http: HttpClientRequest.HttpClientRequest, context: RequestExecutor.Context) =>
  Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
```

Defer that API change until default diagnostics and conservative status retry are proven useful.

## Implementation Plan

1. Add `HttpRequestDetails` and `HttpResponseDetails` schema classes.
2. Optionally add `HttpRateLimitDetails` if it stays provider-neutral.
3. Extend `ProviderRequestError` and `TransportError` with diagnostics and retry hints.
4. Add executor helpers for header normalization, redaction, URL redaction, body truncation, request details, response details, request IDs, retryable status classification, and `Retry-After` parsing.
5. Change `statusError(response)` to `statusError(request)(response)` or equivalent so rich request diagnostics are available.
6. Populate rich `ProviderRequestError` for non-2xx status responses.
7. Populate richer `TransportError` where the underlying HTTP client error exposes a request, but do not retry transport errors by default.
8. Add private conservative retry around `executeOnce` for retryable status responses only.
9. Add deterministic tests for diagnostics, redaction, `Retry-After`, retryable statuses, non-retryable statuses, retry attempts, and no retry after stream parsing begins.

## Tests

Add or extend tests under `packages/llm/test`:

- A `429` response returns `ProviderRequestError` with `retryable: true`, parsed `retryAfterMs`, redacted request headers, redacted response headers, redacted URL query secrets, and request ID.
- A `529` response is treated as retryable.
- A `401` response returns `ProviderRequestError` with `retryable: false` or `undefined`, not retried.
- A `503` followed by a successful SSE response retries exactly once and streams normally.
- A repeated `429` retries up to the default limit, then returns the final enriched error.
- Authorization-like request headers are redacted in the error.
- Query-string secrets are redacted in `request.url`.
- Non-secret headers remain visible for diagnostics.
- Response bodies are truncated and set `bodyTruncated: true` when above the cap.
- Transport timeout or connection errors become `TransportError` diagnostics but are not retried by default.
- Invalid URL or encode failures become `TransportError` with `retryable: false` or `undefined`.
- A first response of `200` with one valid SSE event followed by malformed data is attempted exactly once and fails as a stream/chunk parse error, proving executor retry does not replay partial streams.

Use deterministic scripted HTTP responses over live provider calls. Use a controlled clock or a test-only short retry policy so retry tests are not slow or flaky. Do not add recorded cassettes for retry behavior unless a real provider behavior must be captured.

## Open Questions

- Should explicit `Retry-After` be allowed to exceed `maxDelayMs`, or should the first implementation cap it for responsiveness?
- Should response body redaction go beyond truncation in the first patch, and can recorder secret scanning be reused safely?
- Should `ProviderRequestError` distinguish `rateLimited: true` from generic `retryable: true`, or is `status === 429` sufficient?
- Should default retry later include `500`, `502`, `520`, `522`, or `524` after OpenAI-compatible provider evidence?
- Should ambiguous transport retries be opt-in through a future executor context once the API can see provider/model/request settings?

## Recommended First Patch Boundary

Include diagnostics, redaction for headers and URL query params, response body truncation, request ID extraction, conservative retry classification, `Retry-After` parsing, and default pre-stream retries for explicit rate-limit / overload status responses.

Defer provider-specific error body parsing, public retry configuration, ambiguous transport retries, and broad 5xx retry defaults until after the executor behavior is tested against OpenAI, Anthropic, Gemini, OpenAI-compatible providers, and Bedrock deterministic fixtures.
