# @opencode-ai/http-recorder

Record real Effect HTTP requests once, then replay them from deterministic JSON cassettes.

Use it for provider integrations, retries, polling, multi-step flows, and any test where hand-written HTTP mocks hide too much of the real request shape.

> Public beta. The API depends on Effect 4 beta and may change with Effect's unstable HTTP modules.

## Install

```sh
bun add -d @opencode-ai/http-recorder@beta effect@4.0.0-beta.74
```

The package supports Node.js 22+ and Bun. It is not intended for browsers, workers, or Deno.

Effect 4 beta currently ships an upstream declaration error. TypeScript consumers need:

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Quick Start

```ts
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const getUser = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://api.example.com/users/1"))
  return yield* response.json
})

const result = await Effect.runPromise(getUser.pipe(Effect.provide(HttpRecorder.layerFetch("users/get-one"))))
```

The first local run records:

```text
test/fixtures/recordings/users/get-one.json
```

Later runs replay that cassette without contacting the upstream server. When `CI=true`, missing cassettes fail instead of recording.

## Use Your Existing Client

`layer` wraps an upstream `HttpClient`, preserving custom transports, middleware, proxies, and tracing:

```ts
import { Layer } from "effect"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const recordedClient = HttpRecorder.layer("users/get-one").pipe(Layer.provide(applicationHttpClientLayer))
```

Use `layerFetch` when the standard Effect fetch client is sufficient.

## Refresh A Cassette

Delete exactly the recordings you want to replace, then rerun their tests:

```sh
rm test/fixtures/recordings/users/get-one.json
bun run test users.test.ts
```

There is intentionally no public overwrite mode. Deletion makes the set of recordings being refreshed visible and reviewable.

## Redaction

Secure defaults remove most headers and redact common credentials in headers, URLs, and JSON bodies. Extend those defaults at layer construction:

```ts
HttpRecorder.layerFetch("anthropic/messages", {
  redact: {
    headers: ["x-project-token"],
    allowRequestHeaders: ["anthropic-version"],
    queryParameters: ["session-id"],
    jsonFields: ["user_id"],
    url: (url) => url.replace(/\/accounts\/[^/]+/, "/accounts/{account}"),
    body: (body) => body.replaceAll(/usr_[a-z0-9]+/g, "usr_redacted"),
  },
})
```

| Option                 | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `headers`              | Add sensitive header names. They are retained as `[REDACTED]`.       |
| `allowRequestHeaders`  | Preserve additional non-sensitive request headers for matching.      |
| `allowResponseHeaders` | Preserve additional non-sensitive response headers for replay.       |
| `queryParameters`      | Add sensitive URL query parameter names.                             |
| `jsonFields`           | Recursively redact matching JSON keys in requests and responses.     |
| `url`                  | Stabilize a URL after built-in redaction.                            |
| `body`                 | Stabilize request and response bodies after built-in JSON redaction. |

Before writing, the recorder scans the complete cassette for common credential formats and values from credential-like environment variables. Unsafe cassettes fail without replacing an existing recording.

Redaction is defense in depth, not a substitute for review. Inspect cassette diffs before committing them.

## Matching And Ordering

A cassette contains an ordered sequence of interactions. The first runtime request is checked against the first recorded request, the second against the second, and so on.

This strict ordering correctly models repeated identical requests whose responses change, including retries, polling, and cache tests. JSON object keys are canonicalized before matching.

Concurrent requests are recorded in request-start order even when their responses complete out of order.

Supply a custom equivalence rule when a request contains intentionally volatile data:

```ts
HttpRecorder.layerFetch("events/create", {
  match: (incoming, recorded) =>
    incoming.method === recorded.method && new URL(incoming.url).pathname === new URL(recorded.url).pathname,
})
```

## Configuration

```ts
interface RecorderOptions {
  readonly directory?: string
  readonly metadata?: Record<string, unknown>
  readonly redact?: RedactOptions
  readonly match?: RequestMatcher
}
```

`directory` defaults to `<cwd>/test/fixtures/recordings`.

## Cassette Format

```json
{
  "version": 1,
  "metadata": {
    "name": "users/get-one",
    "recordedAt": "2026-06-05T12:00:00.000Z"
  },
  "interactions": [
    {
      "transport": "http",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/users/1",
        "headers": { "accept": "application/json" },
        "body": ""
      },
      "response": {
        "status": 200,
        "headers": { "content-type": "application/json" },
        "body": "{\"id\":1}"
      }
    }
  ]
}
```

Known text media types remain readable. Other response bodies are stored losslessly as base64.

## Current Limits

- The public API records HTTP only. WebSocket support remains internal while its chronology and lifecycle model are redesigned.
- Responses are buffered while recording and replaying, so this beta is not suitable for tests that assert streaming timing, cancellation, or backpressure.
- The package currently requires the exact Effect beta listed above.
- Cassette format version `1` has no migration tooling yet.

## License

MIT
