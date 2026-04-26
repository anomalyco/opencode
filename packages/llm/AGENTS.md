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

`LLM.request(...)` builds an `LLMRequest`. `client(...)` selects an adapter by `request.model.protocol`, applies patches, prepares a typed provider target, asks the adapter for a real `HttpClientRequest.HttpClientRequest`, sends it through `RequestExecutor.Service`, parses the provider stream into common `LLMEvent`s, and finally returns an `LLMResponse`.

Use `client(...).stream(request)` when callers want incremental `LLMEvent`s. Use `client(...).generate(request)` when callers want those same events collected into an `LLMResponse`.

### Adapters

Adapters are provider/protocol boundaries. They own provider-native schemas and conversion logic. For example, `OpenAIChat.adapter` owns the OpenAI Chat target schema, OpenAI SSE chunk schema, message lowering, tool-call parsing, usage mapping, and finish-reason mapping.

Adapters should stay boring and typed:

- `prepare` lowers common `LLMRequest` into a provider draft.
- target patches mutate that draft before validation.
- `validate` validates the final provider target with Schema.
- `toHttp` creates the `HttpClientRequest`.
- `parse` decodes provider chunks into `LLMEvent`s. The shared `ProviderShared.sse` helper handles SSE framing, chunk decoding, and stateful chunk-to-event raising; adapters supply `decodeChunk` and a `process` callback that produces events.

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

### Completed Foundation

- [x] Add an adapter registry so `client(...)` can choose an adapter by `request.model.protocol` instead of requiring a single adapter.
- [x] Add request/response convenience helpers where callsites still expose schema internals, but keep constructors returning canonical Schema class instances.
- [x] Expand OpenAI Chat support for assistant tool-call messages followed by tool-result messages.
- [x] Add OpenAI Chat recorded tests for tool-result follow-up and usage chunks.
- [x] Add deterministic fixture tests for unsupported content paths, including media in user messages and unsupported assistant content.
- [x] Add provider patch examples from real opencode quirks, starting with prompt normalization and target-level provider options.
- [x] Add an OpenAI Responses adapter once the Chat adapter shape feels stable.
- [x] Add Anthropic Messages adapter coverage after Responses, especially content block mapping, tool use/result mapping, and cache hints.
- [x] Add Gemini adapter coverage for text, media input, tool calls, reasoning deltas, finish reasons, usage, and recorded cassettes.
- [x] Extract or port OpenCode's `ProviderTransform.schema` Gemini sanitizer into a tested `packages/llm` tool-schema patch; do not keep a divergent adapter-local copy long term.

### Provider Coverage

- [x] Add a generic OpenAI-compatible Chat adapter for non-OpenAI providers that expose `/chat/completions`; use `../ai/packages/openai-compatible` as the behavior reference.
- [ ] Keep OpenAI Responses as a separate first-class protocol for providers that actually implement `/responses`; do not treat generic OpenAI-compatible providers as Responses-capable by default.
- [x] Cover OpenAI-compatible provider families that can share the generic adapter first: DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks, DeepInfra, and similar providers.
- [ ] Decide which providers need thin dedicated wrappers over OpenAI-compatible Chat because they have custom parsing/options: Mistral, Groq, xAI, Perplexity, and Cohere.
- [ ] Add Bedrock Converse support or a clear compatibility layer before moving Amazon Bedrock traffic onto `packages/llm`.
- [ ] Decide Vertex shape after Bedrock/OpenAI-compatible are stable: Vertex Gemini as Gemini target/http patch vs adapter, and Vertex Anthropic as Anthropic target/http patch vs adapter.
- [ ] Add Gateway/OpenRouter-style routing support only after the generic OpenAI-compatible adapter and provider option patch model are stable.

### OpenCode Parity Patches

- [ ] Port Anthropic tool-use ordering into a prompt patch.
- [ ] Finish Mistral/OpenAI-compatible cleanup patches, including message sequence repair after tool messages.
- [ ] Port DeepSeek reasoning handling and interleaved reasoning field mapping.
- [ ] Add unsupported attachment fallback patches keyed by model capabilities.
- [ ] Add cache hint patches for Anthropic, OpenRouter, Bedrock, OpenAI-compatible, Copilot, and Alibaba-style providers.
- [ ] Add provider option namespacing patches for Gateway, OpenRouter, Azure, OpenAI-compatible wrappers, and other provider-specific option bags.
- [ ] Add model-specific reasoning option patches for providers that need effort, summary, or native reasoning fields.
- [ ] Add provider-specific metadata extraction patches only where OpenCode needs returned reasoning, citations, usage details, or provider-native fields.

### OpenCode Bridge

- [ ] Build a `Provider.Model` -> `LLM.ModelRef` bridge for OpenCode, including protocol selection, base URLs, headers, limits, capabilities, native provider metadata, and OpenAI-compatible provider family detection.
- [ ] Build a `session.llm` -> `LLM.request(...)` bridge for system prompts, message history, tools, tool choice, generation options, reasoning variants, cache hints, and attachments.
- [ ] Keep auth and deployment concerns in the OpenCode bridge where possible: Bedrock credentials/region/profile, Vertex project/location/token, Azure deployment/API version, and Gateway/OpenRouter routing headers.
- [ ] Keep initial OpenCode integration behind a local flag/path until request payload parity and stream event parity are proven against the existing `session/llm.test.ts` cases.

### Test And Recording Gaps

- [ ] Keep deterministic coverage for malformed chunks and tool arguments that arrive in the first chunk unless a live provider reliably produces those shapes.
- [x] Cover provider-error and HTTP-status sad paths with deterministic fixtures across adapters (Anthropic mid-stream + 4xx; OpenAI Responses mid-stream + 4xx; OpenAI Chat 4xx). Live recordings of provider errors are still TODO when stable cassettes can be captured.
- [ ] Improve cassette ergonomics if more providers need custom matching, redaction, or multi-interaction flows.
- [ ] Mirror OpenCode request-body parity tests through the new LLM path for OpenAI Responses, Anthropic Messages, Gemini, OpenAI-compatible Chat, and Bedrock once supported.
- [ ] Add adapter parity fixtures against `../ai` behavior for generic OpenAI-compatible Chat before adding provider-specific wrappers.
