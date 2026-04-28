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

const response = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] }).generate(request)
```

`LLM.request(...)` builds an `LLMRequest`. `LLMClient.make(...)` selects an adapter by `request.model.protocol`, applies patches, prepares a typed provider target, asks the adapter for a real `HttpClientRequest.HttpClientRequest`, sends it through `RequestExecutor.Service`, parses the provider stream into common `LLMEvent`s, and finally returns an `LLMResponse`.

Use `LLMClient.make(...).stream(request)` when callers want incremental `LLMEvent`s. Use `LLMClient.make(...).generate(request)` when callers want those same events collected into an `LLMResponse`.

### Adapters

Adapters are provider/protocol boundaries. They own provider-native schemas and conversion logic. For example, `OpenAIChat.adapter` owns the OpenAI Chat target schema, OpenAI SSE chunk schema, message lowering, tool-call parsing, usage mapping, and finish-reason mapping.

Adapters should stay boring and typed:

- `prepare` lowers common `LLMRequest` into a provider draft.
- target patches mutate that draft before validation.
- `validate` validates the final provider target with Schema.
- `toHttp` creates the `HttpClientRequest`.
- `parse` decodes provider chunks into `LLMEvent`s. The shared `ProviderShared.framed` helper handles transport-error mapping, chunk decoding, and stateful chunk-to-event raising; adapters supply a `framing` step (bytes → frames), a `decodeChunk`, and a `process` callback that produces events.

The transport is HTTP today, with two framing dialects:

- **SSE** for OpenAI Chat / OpenAI Responses / Anthropic Messages / Gemini / OpenAI-compatible Chat. Use `ProviderShared.sse(...)` — a thin wrapper around `framed` with `sseFraming` (decode bytes → `Sse.decode` → drop `[DONE]` and Retry control events).
- **AWS event stream** for Bedrock Converse. Bedrock supplies its own `eventStreamFraming` step that runs `@smithy/eventstream-codec` against a cursor-based byte buffer.

When a provider ships a non-HTTP transport (OpenAI's WebSocket-based Codex backend, hypothetical bidirectional streaming APIs), it should land as a sibling adapter with a `toWs` (or analogous) producer + a `parse` that reads frames from that transport — not by leaking transport details into core types. The `framed` helper's `framing` parameter is the seam for new wire formats; the rest of the stream pipeline (terminal-error normalization, `mapAccumEffect` state, `onHalt` fallback) is already shared.

### Shared adapter helpers

`ProviderShared` exports a small toolkit so adapters can stay focused on provider-native shapes:

- `framed({ adapter, response, readError, framing, decodeChunk, initial, process, onHalt? })` — the canonical streaming pipeline. Reach for it before hand-rolling a `Stream` chain.
- `sse({ ... })` — convenience wrapper for SSE adapters. Identical shape to `framed` minus the `framing` field.
- `sseFraming` — the SSE-specific framing step, exposed in case an adapter wants to wrap or compose it.
- `joinText(parts)` — joins an array of `TextPart` (or anything with a `.text`) with newlines. Use this anywhere an adapter flattens text content into a single string for a provider field.
- `parseToolInput(adapter, name, raw)` — Schema-decodes a tool-call argument string with the canonical "Invalid JSON input for `<adapter>` tool call `<name>`" error message. Treats empty input as `{}`. Use this in `finishToolCall` / `finalizeToolCalls`; do not roll a fresh `parseJson` callsite.
- `parseJson(adapter, raw, message)` — generic JSON-via-Schema decode for non-tool payloads.
- `chunkError(adapter, message, ...)` — typed `ProviderChunkError` constructor for stream-time failures.

If you find yourself copying a 3-to-5-line snippet between two adapters, lift it into `ProviderShared` next to these helpers rather than duplicating.

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

### Tool runtime

`ToolRuntime.run(client, options)` orchestrates the tool loop with full type safety:

```ts
const get_weather = tool({
  description: "Get current weather for a city",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({ city }) =>
    Effect.gen(function* () {
      // city: string  — typed from parameters Schema
      const data = yield* WeatherApi.fetch(city)
      return { temperature: data.temp, condition: data.cond }
      // return type checked against success Schema
    }),
})

const events = yield* ToolRuntime.run(client, {
  request,
  tools: { get_weather, get_time, ... },
  maxSteps: 10,
  stopWhen: (state) => false,
}).pipe(Stream.runCollect)
```

The runtime:

- Adds tool definitions (derived from each tool's `parameters` Schema via `Schema.toJsonSchemaDocument`) onto `request.tools`.
- Streams the model.
- On `tool-call`: looks up the named tool, decodes input against `parameters` Schema, dispatches to the typed `execute`, encodes the result against `success` Schema, emits `tool-result`.
- Loops when the step finishes with `tool-calls`, appending the assistant + tool messages.
- Stops on a non-`tool-calls` finish, when `maxSteps` is reached, or when `stopWhen` returns `true`.

Handler dependencies (services, permissions, plugin hooks, abort handling) are closed over by the consumer at tool-construction time. The runtime's only environment requirement is `RequestExecutor.Service`. Build the tools record inside an `Effect.gen` once and reuse it across many runs:

```ts
const tools = Effect.gen(function* () {
  const fs = yield* FileSystem
  const permission = yield* Permission
  return {
    read_file: tool({
      ...
      execute: ({ path }) =>
        Effect.gen(function* () {
          yield* permission.ask({ tool: "read_file", path })
          return { content: yield* fs.readFile(path) }
        }),
    }),
  }
})
```

Errors must be expressed as `ToolFailure`. The runtime catches it and emits a `tool-error` event, then a `tool-result` of `type: "error"`, so the model can self-correct on the next step. Anything that is not a `ToolFailure` is treated as a defect and fails the stream. Three recoverable error paths produce `tool-error` events:

- The model called an unknown tool name.
- Input failed the `parameters` Schema.
- The handler returned a `ToolFailure`.

Provider-defined / hosted tools (e.g. Anthropic `web_search` / `code_execution` / `web_fetch`, OpenAI Responses `web_search_call` / `file_search_call` / `code_interpreter_call` / `mcp_call` / `local_shell_call` / `image_generation_call` / `computer_use_call`) pass through the runtime untouched:

- Adapters surface the model's call as a `tool-call` event with `providerExecuted: true`, and the provider's result as a matching `tool-result` event with `providerExecuted: true`.
- The runtime detects `providerExecuted` on `tool-call` and **skips client dispatch** — no handler is invoked and no `tool-error` is raised for "unknown tool". The provider already executed it.
- Both events are appended to the assistant message in `assistantContent` so the next round's history carries the call + result for context. Anthropic encodes them back as `server_tool_use` + `web_search_tool_result` (or `code_execution_tool_result` / `web_fetch_tool_result`) blocks; OpenAI Responses callers typically use `previous_response_id` instead of resending hosted-tool items.

Add provider-defined tools to `request.tools` (no runtime entry needed). The matching adapter must know how to lower the tool definition into the provider-native shape; right now Anthropic accepts `web_search` / `code_execution` / `web_fetch` and OpenAI Responses accepts the hosted tool names listed above.

### Recording Tests

Recorded tests use one cassette file per scenario. A cassette holds an ordered array of `{ request, response }` interactions, so multi-step flows (tool loops, retries, polling) record into a single file. Use `recordedTests({ prefix, requires })` and let the helper derive cassette names from test names:

```ts
const recorded = recordedTests({ prefix: "openai-chat", requires: ["OPENAI_API_KEY"] })

recorded.effect("streams text", () =>
  Effect.gen(function* () {
    // test body
  }),
)
```

Replay is the default. `RECORD=true` records fresh cassettes and requires the listed env vars. Cassettes are written as pretty-printed JSON so multi-interaction diffs stay reviewable.

**Binary response bodies.** Most providers stream text (SSE, JSON). AWS Bedrock streams binary AWS event-stream frames whose CRC32 fields would be mangled by a UTF-8 round-trip — those bodies are stored as base64 with `bodyEncoding: "base64"` on the response snapshot. Detection is by `Content-Type` in `@opencode-ai/http-recorder` (currently `application/vnd.amazon.eventstream` and `application/octet-stream`); cassettes for SSE/JSON adapters omit the field and decode as text.

**Matching strategies.** Replay defaults to structural matching, which finds an interaction by comparing method, URL, allow-listed headers, and the canonical JSON body. This is the right choice for tool loops because each round's request differs (the message history grows). For scenarios where successive requests are byte-identical and expect different responses (retries, polling), pass `dispatch: "sequential"` in `RecordReplayOptions` — replay then walks the cassette in record order via an internal cursor. `scriptedResponses` (in `test/lib/http.ts`) is the deterministic counterpart for tests that don't need a live provider; it scripts response bodies in order without reading from disk.

Do not blanket re-record an entire test file when adding one cassette. `RECORD=true` rewrites every recorded case that runs, and provider streams contain volatile IDs, timestamps, fingerprints, and obfuscation fields. Prefer deleting the one cassette you intend to refresh, or run a focused test pattern that only registers the scenario you want to record. Keep stable existing cassettes unchanged unless their request shape or expected behavior changed.

## TODO

### Completed Foundation

- [x] Add an adapter registry so `LLMClient.make(...)` can choose an adapter by provider/protocol instead of requiring a single adapter.
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

- [x] Add a generic OpenAI-compatible Chat adapter for non-OpenAI providers that expose `/chat/completions`.
- [x] Keep OpenAI Responses as a separate first-class protocol for providers that actually implement `/responses`; do not treat generic OpenAI-compatible providers as Responses-capable by default.
- [x] Cover OpenAI-compatible provider families that can share the generic adapter first: DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks, DeepInfra, and similar providers.
- [ ] Decide which providers need thin dedicated wrappers over OpenAI-compatible Chat because they have custom parsing/options: Mistral, Groq, xAI, Perplexity, and Cohere.
- [x] Add Bedrock Converse support: wire format (messages / system / inferenceConfig / toolConfig), AWS event stream binary framing via `@smithy/eventstream-codec`, SigV4 signing via `aws4fetch` (or Bearer API key path), text/reasoning/tool/usage/finish decoding, cache hints, image/document content, deterministic tests, and recorded basic text/tool cassettes. Additional model-specific fields are still TODO.
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

- [x] Build a `Provider.Model` -> `LLM.ModelRef` bridge for OpenCode, including protocol selection, base URLs, headers, limits, capabilities, native provider metadata, and OpenAI-compatible provider family detection.
- [x] Build a pure `session.llm` -> `LLM.request(...)` bridge for system prompts, message history, tool definitions, tool choice, generation options, reasoning variants, cache hints, and attachments.
- [x] Add a typed `ToolRuntime` that drives the tool loop with Schema-typed parameters/success per tool, single-`ToolFailure` error channel, and `maxSteps`/`stopWhen` controls.
- [x] Provider-defined tool pass-through: `providerExecuted` flag on `tool-call`/`tool-result` events; Anthropic `server_tool_use` / `web_search_tool_result` / `code_execution_tool_result` / `web_fetch_tool_result` round-trip; OpenAI Responses hosted-tool items decoded as `tool-call` + `tool-result` pairs; runtime skips client dispatch when `providerExecuted: true`.
- [ ] Keep auth and deployment concerns in the OpenCode bridge where possible: Bedrock credentials/region/profile, Vertex project/location/token, Azure deployment/API version, and Gateway/OpenRouter routing headers.
- [ ] Keep initial OpenCode integration behind a local flag/path until request payload parity and stream event parity are proven against the existing `session/llm.test.ts` cases.

### Native OpenCode Rollout

- [x] Add a native event bridge that maps `LLMEvent` streams into the existing `SessionProcessor` event contract without creating a second processor.
- [ ] Extract runtime-neutral OpenCode tool resolution from `SessionPrompt.resolveTools`, then build both existing-stream and native `@opencode-ai/llm` tool adapters from the same resolved shape.
- [ ] Map `Permission.RejectedError`, `Permission.CorrectedError`, validation failures, thrown tool failures, and aborts into model-visible native tool error/results.
- [ ] Wire a native stream producer behind an explicit local flag and provider allowlist; the producer should consume `nativeMessages`, call `LLMNative.request(...)`, stream through `LLMClient.make(...)`, and feed `LLMNativeEvents.mapper()` into `SessionProcessor`.
- [ ] Add end-to-end native stream tests through the actual session loop for text, reasoning, tool-call streaming, tool success, rejected permission, corrected permission, thrown tool error, abort, and provider-executed tool history.
- [ ] Dogfood native streaming with the flag enabled for OpenAI first, then Anthropic, Gemini, OpenAI-compatible providers, Bedrock, and Copilot provider-by-provider.
- [ ] Flip native streaming to default only after request parity, stream parity, tool execution, typecheck, focused provider tests, recorded cassettes, and manual dogfood pass for the enabled provider set.
- [ ] Keep the existing stream path as an opt-out fallback during soak; remove it only after native default has proven stable.

### Test And Recording Gaps

- [x] Harden the generic HTTP recorder before adding more live cassettes: secret scanning before writes, sensitive header/query redaction, response/body secret scanning, and clear failure messages that identify the unsafe field without printing the secret.
- [x] Refactor the recorder toward extractable library boundaries: core HTTP cassette schema/matching/redaction/diffing should stay LLM-agnostic; LLM tests should supply metadata and semantic assertions from a thin wrapper.
- [x] Add cassette metadata support: recorder schema version, recorded timestamp, scenario name, tags, and caller-provided subject metadata such as provider/protocol/model/capabilities without making the core recorder depend on LLM concepts.
- [x] Improve replay mismatch diagnostics: show method/URL/header/body diffs and closest recorded interaction while keeping secrets redacted. Unused-interaction reporting is still TODO if a test needs it.
- [ ] Add semantic replay assertions for LLM cassettes: replay raw HTTP, parse provider streams, and compare normalized `LLMEvent[]` or `LLMResponse` snapshots in addition to request matching.
- [ ] Add stream chunk-boundary fuzzing for text/SSE cassettes so parser tests prove correctness independent of provider chunk boundaries.
- [ ] Keep deterministic coverage for malformed chunks and tool arguments that arrive in the first chunk unless a live provider reliably produces those shapes.
- [x] Cover provider-error and HTTP-status sad paths with deterministic fixtures across adapters (Anthropic mid-stream + 4xx; OpenAI Responses mid-stream + 4xx; OpenAI Chat 4xx). Live recordings of provider errors are still TODO when stable cassettes can be captured.
- [x] Improve cassette ergonomics for multi-interaction flows: pretty-printed JSON for diff-friendly cassettes, explicit sequential dispatch, and a recorded tool-loop scaffold (`openai-chat-tool-loop.recorded.test.ts`).
- [x] Mirror OpenCode request-body parity tests through the new LLM path for OpenAI Responses, Anthropic Messages, Gemini, OpenAI-compatible Chat, and Bedrock once supported.
- [x] Add adapter parity fixtures for generic OpenAI-compatible Chat before adding provider-specific wrappers.

### Recorded Cassette Backlog

- [x] DeepSeek OpenAI-compatible Chat basic streaming text.
- [ ] DeepSeek OpenAI-compatible Chat tool call and tool-result follow-up.
- [ ] DeepSeek reasoning output, including any interleaved reasoning fields the live API emits.
- [x] TogetherAI OpenAI-compatible Chat basic streaming text and tool-call flow.
- [ ] Cerebras OpenAI-compatible Chat basic streaming text and tool-call flow.
- [ ] Baseten OpenAI-compatible Chat basic streaming text and deployed-model request shape.
- [ ] Fireworks OpenAI-compatible Chat basic streaming text and tool-call flow.
- [ ] DeepInfra OpenAI-compatible Chat basic streaming text and tool-call flow.
- [ ] Provider-error cassettes for stable, non-secret error bodies where the provider returns deterministic 4xx/5xx payloads.
- [ ] Mistral, Groq, xAI, Perplexity, and Cohere basic/tool cassettes after deciding whether each stays generic OpenAI-compatible or gets a thin wrapper.
- [x] Bedrock Converse basic text and tool-call cassettes (recorded against `us.amazon.nova-micro-v1:0` in us-east-1). Cache-hint cassettes still TODO.
- [ ] Vertex Gemini and Vertex Anthropic basic/tool cassettes after the Vertex adapter/patch shape is decided.
- [ ] Gateway/OpenRouter routing-header cassettes after routing support lands.
