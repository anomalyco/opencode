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
By default the layer records on first run and replays on subsequent runs —
no env-var ternary at the call site, and `CI=true` forces strict replay so
missing cassettes fail loudly in CI rather than silently re-recording.

```ts
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const program = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://api.example.com/users/1"))
  return yield* response.json
})

// Records if the cassette is missing, replays if it exists.
// In CI (CI=true) always replays — fails loudly on missing fixtures.
Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.cassetteLayer("users/get-one"))))

// Force a refresh — always hits upstream and overwrites.
Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.cassetteLayer("users/get-one", { mode: "record" }))))
```

## Modes

| Mode          | Behavior                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| `auto`        | Default. Replay if the cassette exists; record if missing. `CI=true` forces replay. |
| `replay`      | Strict — match the request to a recorded interaction; error if none.                |
| `record`      | Execute upstream, append the interaction, write the cassette.                       |
| `passthrough` | Bypass the recorder entirely — just call upstream.                                  |

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

Replay walks the cassette in record order via an internal cursor: the Nth
request executed at runtime is served by the Nth recorded interaction, and
each one is validated as the cursor advances. Request equality is computed
on canonicalized method, URL, headers, and JSON body (object keys sorted).

This is deliberately strict — content-based dispatch was removed because
it silently returns the first recorded response for repeated identical
requests, masking state changes that retry/polling/cache-hit tests need to
observe. If you reorder requests in a test, re-record the cassette.

Supply your own matcher via `match: (incoming, recorded) => boolean` for
custom equivalence (e.g. ignoring a timestamp field in the body).

## Redaction & secret safety

Cassettes get checked in, so the recorder is aggressive about not letting
secrets escape. Redaction is configured by composing a `Redactor`:

```ts
import { HttpRecorder, Redactor } from "@opencode-ai/http-recorder"

HttpRecorder.cassetteLayer("anthropic/messages", {
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
    cassette,
    live: liveExecutor,
  })
  // use executor.open(...)
})
```

## Inspecting cassettes programmatically

`Cassette.Service` exposes `read`, `append`, `exists`, and `list`. `read`
returns the recorded interactions for a name; the file format is hidden
behind the seam. Useful for CI checks:

```ts
import { HttpRecorder } from "@opencode-ai/http-recorder"
import { Effect } from "effect"

const audit = Effect.gen(function* () {
  const cassettes = yield* HttpRecorder.Cassette.Service
  const entries = yield* cassettes.list()
  const issues = yield* Effect.forEach(entries, (entry) =>
    cassettes
      .read(entry.name)
      .pipe(Effect.map((interactions) => ({ name: entry.name, findings: HttpRecorder.secretFindings(interactions) }))),
  )
  return issues.filter((i) => i.findings.length > 0)
})
```

`cassetteLayer` is the batteries-included entry point — it provides
`Cassette.fileSystem({ directory })` automatically. If you want to provide
your own `Cassette.Service` (e.g. an in-memory adapter for the recorder's
own unit tests), use `recordingLayer` and supply `Cassette.fileSystem` /
`Cassette.memory` yourself.

## Options reference

```ts
type RecordReplayOptions = {
  mode?: "auto" | "replay" | "record" | "passthrough" // default: "auto" (CI=true forces "replay")
  directory?: string // default: <cwd>/test/fixtures/recordings
  metadata?: Record<string, unknown> // merged into cassette.metadata
  redactor?: Redactor // default: Redactor.defaults()
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
| `matching.ts`  | Request matcher, canonicalization, sequential cursor, mismatch diagnostics.      |
