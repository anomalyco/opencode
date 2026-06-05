# @opencode-ai/http-recorder

Record and replay HTTP traffic for Effect's `HttpClient`. Tests exercise real
request shapes against deterministic, version-controlled cassettes — no manual
mocks, no flakes from upstream drift.

## Install

This package targets Node.js and Bun. It uses Node filesystem storage and is
not currently supported in browsers, workers, or Deno.

Requirements:

- Node.js 22 or newer, or Bun
- `effect@4.0.0-beta.74`
- TypeScript consumers must currently enable `skipLibCheck` because the
  published Effect 4 beta declarations contain an upstream internal Schema
  declaration error

```sh
bun add -d @opencode-ai/http-recorder
```

## Quickstart

`layer` wraps your existing `HttpClient`. It records on the first local run and
replays on subsequent runs. `CI=true` forces strict replay, so CI never records
a missing cassette.

```ts
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Layer } from "effect"
import { HttpRecorder } from "@opencode-ai/http-recorder"

const program = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://api.example.com/users/1"))
  return yield* response.json
})

const recorderLayer = HttpRecorder.layer("users/get-one").pipe(Layer.provide(FetchHttpClient.layer))

Effect.runPromise(program.pipe(Effect.provide(recorderLayer)))
```

For the common fetch-backed case, `layerFetch` provides the upstream client too:

```ts
const recorderLayer = HttpRecorder.layerFetch("users/get-one")
```

To refresh recordings, delete the selected cassette files and rerun their
tests. This works for one cassette or any chosen set without granting a test
run permission to overwrite unrelated fixtures.

```sh
rm test/fixtures/recordings/users/get-one.json
bun run test users.test.ts
```

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

Cassettes get checked in, so the recorder applies secure defaults and lets you
declaratively extend them at layer construction:

```ts
import { HttpRecorder } from "@opencode-ai/http-recorder"

HttpRecorder.layer("anthropic/messages", {
  redact: {
    headers: ["x-project-token"],
    allowRequestHeaders: ["anthropic-version"],
    queryParameters: ["session-id"],
    jsonFields: ["user_id"],
    url: (url) => url.replace(/\/accounts\/[^/]+/, "/accounts/{account}"),
  },
})
```

What each option does:

- **`headers`** adds sensitive header names. Request and response headers are
  stripped to small allow-lists before these values are replaced.
- **`allowRequestHeaders` / `allowResponseHeaders`** add non-sensitive headers
  that affect matching or replay behavior.
- **`queryParameters`** adds sensitive query parameter names.
- **`jsonFields`** recursively redacts matching request and response JSON keys.
- **`url`** and **`body`** apply narrow custom stabilization after built-in redaction.

Configured names extend the defaults. They never disable built-in protection
for authorization, cookies, common API-key headers, signed query parameters,
or credential-like JSON fields.

After assembling the cassette, the recorder scans every string for known
secret patterns (Bearer tokens, `sk-…`, `sk-ant-…`, Google `AIza…` keys,
AWS access keys, GitHub tokens, PEM blocks) and for values matching any
environment variable named like a credential. If anything is found, the
cassette is **not written** and the request fails with `UnsafeCassetteError`
listing what was detected.

## Options reference

```ts
type RecorderOptions = {
  directory?: string // default: <cwd>/test/fixtures/recordings
  metadata?: Record<string, unknown> // merged into cassette.metadata
  redact?: {
    headers?: ReadonlyArray<string>
    allowRequestHeaders?: ReadonlyArray<string>
    allowResponseHeaders?: ReadonlyArray<string>
    queryParameters?: ReadonlyArray<string>
    jsonFields?: ReadonlyArray<string>
    url?: (url: string) => string
    body?: (body: string) => string
  }
  match?: (incoming, recorded) => boolean // custom matcher
}
```
