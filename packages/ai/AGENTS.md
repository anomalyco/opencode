# AI Package Guide

## Principles

- **Forward compatibility.** Providers ship new models, options, and values constantly. Accept unknown pass-through values (`Known | (string & {})` for string options); use closed literals only when OpenCode branches on the value.
- **Tolerate unknowns.** Unknown provider events, statuses, and enum values must not fail a request; ignore them or pass them through. Fail only on errors in the provider's documented shape, malformed known types, or a missing terminal event.
- **One canonical model.** The Schema classes in `src/schema/` are the data model. Do not add a parallel shape or a second construction path.
- **Independent of Session.** Auth, permissions, plugins, and orchestration belong in Core. `ai.stream`/`ai.generate` run exactly one model call.
- **Reuse protocols.** Providers compose existing protocols with `Route.make(...)` instead of cloning them.
- **One API, two runtimes.** `ai` from `@opencode/ai` and `ai` from `@opencode/ai/effect` have the same namespaces and operations, with the same names, overloads, input and options (plus `RunOptions`, `signal` and `http`, on the Promise side); keep `test/promise-parity.types.ts` passing.
- **One way to hook HTTP.** Every request goes through `RequestExecutor`, which applies executor-wide middleware (`RequestExecutor.middleware`) and the caller's scoped middleware (`RequestExecutor.withMiddleware`, Promise `{ http }`). Don't add a per-method hook option or send HTTP any other way. A `url` asset downloads with its own `middleware`, which a route sets only for URLs on the provider's origin. Types already require every route to send through the executor it is given, and lint rejects `fetch` and the `HttpClient` import outside `route/executor.ts`. Keep `test/http-hooks.test.ts` passing; it lists every Promise method.

## Code style

- Use `HttpClient`, `Stream`, and Schema codecs instead of `fetch`, async generators, and `JSON.parse`/`JSON.stringify`.
- `return yield* new MyError(...)` instead of `Effect.fail(...)`; `Effect.void` instead of `Effect.succeed(undefined)`.
- Only `src/index.ts` (the Promise entry) may use Promises.

## Tests

- Use `testEffect(...)` from `test/lib/effect.ts` for tests that need Effect layers.
- Provider tests replay cassettes: recorded HTTP exchanges stored as JSON in `test/fixtures/recordings/`, one file per scenario. Replay is the default and needs no API keys.
- To record, unset `CI` and run with `RECORD=true` plus the provider's API key. Re-record only the cassette you are changing; recordings contain volatile IDs that create noisy diffs.
