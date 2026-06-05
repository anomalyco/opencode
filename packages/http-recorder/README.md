# @opencode-ai/http-recorder

Record real Effect HTTP and WebSocket traffic once, then replay it from deterministic JSON cassettes.

Use it for provider integrations, retries, polling, multi-step flows, and any test where hand-written HTTP mocks hide too much of the real request shape.

> Public beta. The API depends on Effect 4 beta and may change with Effect's unstable HTTP modules.

## Install

```sh
bun add effect@4.0.0-beta.74
bun add -d @opencode-ai/http-recorder@beta @effect/vitest vitest
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
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})

const getUser = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://jsonplaceholder.typicode.com/users/1"))
  return yield* Schema.decodeUnknownEffect(User)(yield* response.json)
})

describe("getUser", () => {
  it.effect("loads a user", () =>
    Effect.gen(function* () {
      const user = yield* getUser

      assert.strictEqual(user.id, 1)
      assert.strictEqual(user.name, "Leanne Graham")
    }).pipe(Effect.provide(HttpRecorder.layerFetch("users/get-one"))),
  )
})
```

Run the test with Vitest. The first local run calls the real API and records:

```sh
bunx vitest run users.test.ts
```

```text
test/fixtures/recordings/users/get-one.json
```

Later runs replay that cassette without contacting the upstream server. When `CI=true`, missing cassettes fail instead of recording.

```mermaid
flowchart LR
  Test[Test effect] --> Recorder{Cassette exists?}
  Recorder -->|Yes| Replay[Replay response]
  Recorder -->|No, local| API[Call real service]
  API --> Save[(Write cassette)]
  Save --> Test
  Recorder -->|No, CI| Fail[Fail test]
  Replay --> Test
```

The recorder is an `HttpClient` layer, so application code remains unaware of whether a response is live or replayed:

```mermaid
sequenceDiagram
  participant Test
  participant App as Application code
  participant Recorder
  participant Cassette
  participant API as Real API

  Test->>App: Run effect with recorder layer
  App->>Recorder: HTTP request
  Recorder->>Cassette: Match next interaction
  alt Recorded interaction exists
    Cassette-->>Recorder: Recorded response
  else Missing locally
    Recorder->>API: HTTP request
    API-->>Recorder: Live response
    Recorder->>Cassette: Append redacted interaction
  end
  Recorder-->>App: HTTP response
  App-->>Test: Decoded result
```

## Use Your Existing Client

`layer` wraps an upstream `HttpClient`, preserving custom transports, middleware, proxies, and tracing:

```ts
import { Layer } from "effect"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const recordedClient = HttpRecorder.layer("users/get-one").pipe(Layer.provide(applicationHttpClientLayer))
```

Use `layerFetch` when the standard Effect fetch client is sufficient.

## WebSockets

WebSocket cassettes preserve one ordered transcript of client and server text or binary frames. Replay follows that chronology: server frames are released until the next recorded client frame, then replay waits for the application to send the matching frame before continuing.

```ts
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import { Socket } from "effect/unstable/socket"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const echo = Effect.gen(function* () {
  const socket = yield* Socket.Socket
  const write = yield* socket.writer

  yield* socket.runString(
    (message) =>
      Effect.gen(function* () {
        assert.strictEqual(message, "hello")
        yield* write(new Socket.CloseEvent(1000))
      }),
    { onOpen: write("hello") },
  )
})

it.effect("exchanges WebSocket frames", () =>
  echo.pipe(Effect.provide(HttpRecorder.layerWebSocket("echo/hello", "wss://ws.postman-echo.com/raw"))),
)
```

```mermaid
sequenceDiagram
  participant App
  participant Recorder
  participant Cassette
  participant WebSocket

  App->>Recorder: Open socket run
  alt Cassette exists
    Cassette-->>Recorder: Ordered frame transcript
    Recorder-->>App: Server frame
    App->>Recorder: Client frame
    Recorder->>Recorder: Validate next event
    Recorder-->>App: Next server frame
  else First local run
    Recorder->>WebSocket: Open live connection
    App->>Recorder: Client frame
    Recorder->>WebSocket: Client frame
    WebSocket-->>Recorder: Server frame
    Recorder-->>App: Server frame
    Recorder->>Cassette: Save redacted transcript
  end
```

`layerWebSocket` supplies Effect's standard Node WebSocket transport. Use `layerSocket(name, request, options)` to wrap an existing `Socket.Socket` when the application needs a custom transport, authorization headers, proxying, or tracing. The `request` URL and headers are used for redacted cassette matching; the recorder does not modify the upstream handshake.

Text frames use the same JSON-field and body redaction as HTTP bodies. Binary frames are stored losslessly as base64. Client and server frame kinds must match during replay.

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

WebSocket interactions use an ordered `events` array so client/server interleaving remains causal:

```json
{
  "transport": "websocket",
  "open": { "url": "wss://api.example.com/realtime", "headers": {} },
  "events": [
    { "direction": "server", "kind": "text", "body": "{\"type\":\"session.created\"}" },
    { "direction": "client", "kind": "text", "body": "{\"type\":\"response.create\"}" },
    { "direction": "server", "kind": "text", "body": "{\"type\":\"response.completed\"}" }
  ]
}
```

## Current Limits

- Responses are buffered while recording and replaying, so this beta is not suitable for tests that assert streaming timing, cancellation, or backpressure.
- WebSocket replay preserves frame chronology and content, not real network timing or backpressure.
- WebSocket V1 cassettes do not reproduce terminal close codes, close reasons, or transport failures. Failed and interrupted live runs are not recorded.
- One recorder-provided `Socket.Socket` supports one active run at a time. Create separate layers for concurrent connections.
- WebSocket transcripts are retained in memory until the connection finishes; avoid using this beta for unbounded sessions.
- The package currently requires the exact Effect beta listed above.
- Cassette format version `1` has no migration tooling yet.

## License

MIT
