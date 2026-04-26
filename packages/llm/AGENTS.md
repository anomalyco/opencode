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

## Architecture

This package is an Effect Schema-first LLM core. The Schema classes in `src/schema.ts` are the canonical runtime data model. Convenience functions in `src/llm.ts` are thin constructors that return those same Schema class instances; they should improve callsites without creating a second model.

### Request Flow

The intended callsite is:

```ts
const request = LLM.request({
  model: OpenAIChat.model({ id: "gpt-4o-mini", apiKey }),
  system: "You are concise.",
  prompt: "Say hello.",
})

const response = yield* client({ adapters: [OpenAIChat.adapter] }).generate(request)
```

`LLM.request(...)` builds an `LLMRequest`. `client(...)` selects an adapter by `request.model.protocol`, applies patches, prepares a typed provider target, asks the adapter for a real `HttpClientRequest.HttpClientRequest`, sends it through `RequestExecutor.Service`, parses the provider stream, raises common `LLMEvent`s, and finally returns an `LLMResponse`.

Use `client(...).stream(request)` when callers want incremental `LLMEvent`s. Use `client(...).generate(request)` when callers want those same events collected into an `LLMResponse`.

### Adapters

Adapters are provider/protocol boundaries. They own provider-native schemas and conversion logic. For example, `OpenAIChat.adapter` owns the OpenAI Chat target schema, OpenAI SSE chunk schema, message lowering, tool-call parsing, usage mapping, and finish-reason mapping.

Adapters should stay boring and typed:

- `prepare` lowers common `LLMRequest` into a provider draft.
- target patches mutate that draft before validation.
- `validate` validates the final provider target with Schema.
- `toHttp` creates the `HttpClientRequest`.
- `parse` decodes provider chunks from `HttpClientResponse`.
- `raise` converts provider chunks into common `LLMEvent`s.

### Patches

Patches are the forcing function for provider/model quirks. If a behavior is not universal enough for common IR, keep it as a named patch with a trace entry. Good examples:

- OpenAI Chat streaming usage: `target.openai-chat.include-usage` adds `stream_options.include_usage`.
- Anthropic prompt caching: map common cache hints onto selected content/message blocks.
- Mistral/OpenAI-compatible prompt cleanup: normalize empty text content or tool-call IDs only for affected models.
- Reasoning models: map common reasoning intent to provider-specific effort, summary, or encrypted-content fields.

Do not grow common request schemas just to fit one provider. Prefer adapter-local target schemas plus patches selected by provider/model predicates.

### Tools

Tool loops are represented in common messages and events:

```ts
const call = LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })
const result = LLM.toolMessage({ id: "call_1", name: "lookup", result: { forecast: "sunny" } })

const followUp = LLM.request({
  model,
  messages: [LLM.user("Weather?"), LLM.assistant([call]), result],
})
```

Adapters lower this into provider-native assistant tool-call messages and tool-result messages. Streaming providers should emit `tool-input-delta` events while arguments arrive, then a final `tool-call` event with parsed input.

### Recording Tests

Recorded tests use one cassette per scenario. Use `recordedTests({ prefix, requires })` and let the helper derive cassette names from test names:

```ts
const recorded = recordedTests({ prefix: "openai-chat", requires: ["OPENAI_API_KEY"] })

recorded.effect("streams text", () => Effect.gen(function* () {
  // test body
}))
```

Replay is the default. `RECORD=true` records fresh cassettes and requires the listed env vars.

Do not blanket re-record an entire test file when adding one cassette. `RECORD=true` rewrites every recorded case that runs, and provider streams contain volatile IDs, timestamps, fingerprints, and obfuscation fields. Prefer deleting the one cassette you intend to refresh, or run a focused test pattern that only registers the scenario you want to record. Keep stable existing cassettes unchanged unless their request shape or expected behavior changed.

## TODO

- [x] Add an adapter registry so `client(...)` can choose an adapter by `request.model.protocol` instead of requiring a single adapter.
- [x] Add request/response convenience helpers where callsites still expose schema internals, but keep constructors returning canonical Schema class instances.
- [x] Expand OpenAI Chat support for assistant tool-call messages followed by tool-result messages.
- [x] Add OpenAI Chat recorded tests for tool-result follow-up and usage chunks.
- [ ] Add OpenAI Chat provider-error/sad-path recordings when live API failures produce useful stable cassettes.
- [ ] Keep deterministic coverage for malformed chunks and tool arguments that arrive in the first chunk unless a live provider reliably produces those shapes.
- [x] Add deterministic fixture tests for unsupported content paths, including media in user messages and unsupported assistant content.
- [x] Add provider patch examples from real opencode quirks, starting with prompt normalization and target-level provider options.
- [ ] Add an OpenAI Responses adapter once the Chat adapter shape feels stable.
- [ ] Add Anthropic Messages adapter coverage after Responses, especially content block mapping, tool use/result mapping, and cache hints.
- [ ] Improve cassette ergonomics if more providers need custom matching, redaction, or multi-interaction flows.
- [ ] Keep opencode integration out until the package handles the core text, tool-call, and tool-result loops cleanly in isolation.
