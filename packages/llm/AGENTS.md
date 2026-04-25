# LLM Package Guide

## Effect

- Prefer `HttpClient.HttpClient` / `HttpClientResponse.HttpClientResponse` over web `fetch` / `Response` at package boundaries.
- Use `Stream.Stream` for streaming transformations. Avoid ad hoc async generators or manual web reader loops unless an Effect `Stream` API cannot model the behavior.
- Use Effect Schema codecs for JSON encode/decode (`Schema.fromJsonString(...)`) instead of direct `JSON.parse` / `JSON.stringify` in implementation code.
- In `Effect.gen`, yield yieldable errors directly (`return yield* new MyError(...)`) instead of `Effect.fail(new MyError(...))`.
- Use `Effect.void` instead of `Effect.succeed(undefined)` when the successful value is intentionally void.

## Tests

- Use `testEffect(...)` from `test/lib/effect.ts` for tests requiring Effect layers.
- Keep provider tests fixture-first. Live provider calls must stay behind `RECORD=true` and required API-key checks.

## TODO

- [ ] Add an adapter registry so `client(...)` can choose an adapter by `request.model.protocol` instead of requiring a single adapter.
- [ ] Add request/response convenience helpers where callsites still expose schema internals, but keep constructors returning canonical Schema class instances.
- [ ] Expand OpenAI Chat support for assistant tool-call messages followed by tool-result messages.
- [ ] Add OpenAI Chat recorded tests for tool-result follow-up, usage chunks, malformed chunks, and tool arguments that arrive in the first chunk.
- [ ] Add deterministic fixture tests for unsupported content paths, including media in user messages and unsupported assistant content.
- [ ] Add provider patch examples from real opencode quirks, starting with prompt normalization and target-level provider options.
- [ ] Add an OpenAI Responses adapter once the Chat adapter shape feels stable.
- [ ] Add Anthropic Messages adapter coverage after Responses, especially content block mapping, tool use/result mapping, and cache hints.
- [ ] Improve cassette ergonomics if more providers need custom matching, redaction, or multi-interaction flows.
- [ ] Keep opencode integration out until the package handles the core text, tool-call, and tool-result loops cleanly in isolation.
