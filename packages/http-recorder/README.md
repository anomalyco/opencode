# @opencode-ai/http-recorder

Record and replay HTTP and WebSocket traffic for Effect's `HttpClient`. Tests
exercise real request shapes against deterministic, version-controlled
cassettes — no manual mocks, no flakes from upstream drift.

## Install

Internal package; depended on as `@opencode-ai/http-recorder` from another
workspace package.

```ts
import { HttpRecorder } from "@opencode-ai/http-recorder"
```

## Quickstart

Provide `cassetteLayer(name)` in place of (or layered over) your `HttpClient`.
The first run records to `test/fixtures/recordings/<name>.json`; subsequent
runs replay from it.

```ts
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const program = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://api.example.com/users/1"))
  return yield* response.json
})

// Replay (default). Fails if the cassette is missing.
Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.cassetteLayer("users/get-one"))))

// Record. Hits the upstream and writes the cassette.
Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.cassetteLayer("users/get-one", { mode: "record" }))))
```

Set the mode from the environment in your test setup:

```ts
HttpRecorder.cassetteLayer("users/get-one", {
  mode: process.env.RECORD === "true" ? "record" : "replay",
})
```

## Modes

| Mode          | Behavior                                                             |
| ------------- | -------------------------------------------------------------------- |
| `replay`      | Default. Match the request to a recorded interaction; error if none. |
| `record`      | Execute upstream, append the interaction, write the cassette.        |
| `passthrough` | Bypass the recorder entirely — just call upstream.                   |

## Cassette format

A cassette is JSON at `test/fixtures/recordings/<name>.json`:

```json
{
  "version": 1,
  "metadata": { "name": "users/get-one", "recordedAt": "2026-05-09T..." },
  "interactions": [
    {
      "transport": "http",
      "request":  { "method": "GET", "url": "...", "headers": {...}, "body": "" },
      "response": { "status": 200, "headers": {...}, "body": "..." }
    }
  ]
}
```

Cassettes are normal source files — review them, diff them, commit them.

## Request matching

By default, requests match on canonicalized method, URL, headers, and JSON
body (object keys sorted). Two dispatch strategies are available:

- **`match`** (default) — find the first recorded interaction whose request
  matches the incoming request. Same request twice returns the same response.
- **`sequential`** — return interactions in the order they were recorded,
  validating each one matches as the cursor advances. Use for ordered flows
  where the same URL is hit multiple times with meaningful state changes
  (pagination, retries, polling).

```ts
HttpRecorder.cassetteLayer("flow/poll-until-done", { dispatch: "sequential" })
```

Supply your own matcher via `match: (incoming, recorded) => boolean` for
custom equivalence (e.g. ignoring a timestamp field in the body).

## Redaction & secret safety

Cassettes get checked in, so the recorder is aggressive about not letting
secrets escape. Redaction is configured by composing a `Redactor`:

```ts
import { HttpRecorder, Redactor } from "@opencode-ai/http-recorder"

HttpRecorder.cassetteLayer("anthropic/messages", {
  mode: process.env.RECORD === "true" ? "record" : "replay",
  redactor: Redactor.defaults({
    requestHeaders: { allow: ["content-type", "anthropic-version"] },
    url: { transform: (url) => url.replace(/\/accounts\/[^/]+/, "/accounts/{account}") },
    body: (parsed) => ({ ...(parsed as object), user_id: "{user}" }),
  }),
})
```

`Redactor.defaults({ … })` composes the four built-in redactors with your
overrides. For full control, build the stack yourself:

```ts
const redactor = Redactor.compose(
  Redactor.requestHeaders({ allow: ["content-type", "x-custom"] }),
  Redactor.responseHeaders(),
  Redactor.url({ query: ["session-id"] }),
  Redactor.body((parsed) => /* … */),
)
```

What each layer does:

- **`requestHeaders` / `responseHeaders`** — strip headers to a small
  allow-list (request default: `content-type`, `accept`, `openai-beta`;
  response default: `content-type`). Sensitive headers within the
  allow-list (`authorization`, `cookie`, API-key headers, AWS/GCP tokens,
  …) are replaced with `[REDACTED]`.
- **`url`** — query parameters matching common secret names (`api_key`,
  `token`, `signature`, AWS signing params, …) are replaced with
  `[REDACTED]`. URL user/password are replaced. `transform` runs after
  built-in redaction for path-level scrubbing.
- **`body`** — receives the parsed JSON request body and returns a redacted
  version. No-op for non-JSON bodies.

After assembling the cassette, the recorder scans every string for known
secret patterns (Bearer tokens, `sk-…`, `sk-ant-…`, Google `AIza…` keys,
AWS access keys, GitHub tokens, PEM blocks) and for values matching any
environment variable named like a credential. If anything is found, the
cassette is **not written** and the request fails with `UnsafeCassetteError`
listing what was detected.

## WebSocket recording

WebSocket support records the open frame plus client/server message
streams. It uses the shared `Cassette.Service`, so HTTP and WS interactions
can live in the same cassette.

```ts
import { HttpRecorder } from "@opencode-ai/http-recorder"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const cassette = yield* HttpRecorder.Cassette.Service
  const executor = yield* HttpRecorder.makeWebSocketExecutor({
    name: "ws/subscribe",
    mode: process.env.RECORD === "true" ? "record" : "replay",
    cassette,
    live: liveExecutor,
  })
  // use executor.open(...)
})
```

## Inspecting cassettes programmatically

`Cassette.Service` exposes `read`, `write`, `append`, `exists`, `list`, and
`scan` (re-running the secret detector over an existing cassette). Useful
for CI checks:

```ts
import { HttpRecorder } from "@opencode-ai/http-recorder"
import { Effect } from "effect"

const audit = Effect.gen(function* () {
  const cassettes = yield* HttpRecorder.Cassette.Service
  const findings = yield* Effect.forEach(yield* cassettes.list(), (entry) =>
    cassettes.read(entry.name).pipe(Effect.map((c) => ({ entry, findings: cassettes.scan(c) }))),
  )
  return findings.filter((r) => r.findings.length > 0)
})
```

## Options reference

```ts
type RecordReplayOptions = {
  mode?: "record" | "replay" | "passthrough" // default: "replay"
  directory?: string // default: <cwd>/test/fixtures/recordings
  metadata?: Record<string, unknown> // merged into cassette.metadata
  redactor?: Redactor // default: Redactor.defaults()
  dispatch?: "match" | "sequential" // default: "match"
  match?: (incoming, recorded) => boolean // custom matcher
}
```

## Layout

| File           | Purpose                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `effect.ts`    | `cassetteLayer` / `recordingLayer` — the `HttpClient` adapter.                   |
| `websocket.ts` | `makeWebSocketExecutor` — WebSocket record/replay.                               |
| `cassette.ts`  | `Cassette.Service` — reads/writes cassette files, accumulates state.             |
| `recorder.ts`  | Shared transport plumbing: `UnsafeCassetteError`, `appendOrFail`, `ReplayState`. |
| `redactor.ts`  | Composable `Redactor` — headers, url, body redaction.                            |
| `redaction.ts` | Lower-level header/URL primitives + secret pattern detection.                    |
| `schema.ts`    | Effect Schema definitions for the cassette JSON format.                          |
| `storage.ts`   | Path resolution, JSON encode/decode, sync existence check.                       |
| `matching.ts`  | Request matcher, canonicalization, dispatch strategies, mismatch diagnostics.    |
