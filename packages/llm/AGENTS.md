# LLM Package Guide

## Effect

- Prefer `HttpClient.HttpClient` / `HttpClientResponse.HttpClientResponse` over web `fetch` / `Response` at package boundaries.
- Use `Stream.Stream` for streaming data flow. Avoid ad hoc async generators or manual web reader loops unless an Effect `Stream` API cannot model the behavior.
- Use Effect Schema codecs for JSON encode/decode (`Schema.fromJsonString(...)`) instead of direct `JSON.parse` / `JSON.stringify` in implementation code.
- In `Effect.gen`, yield yieldable errors directly (`return yield* new MyError(...)`) instead of `Effect.fail(new MyError(...))`.
- Use `Effect.void` instead of `Effect.succeed(undefined)` when the successful value is intentionally void.

## Tests

- Use `testEffect(...)` from `test/lib/effect.ts` for tests requiring Effect layers.
- Keep provider tests fixture-first. Live provider calls must stay behind `RECORD=true` and required API-key checks.

## Architecture

This package is an Effect Schema-first LLM core. The Schema classes in `src/schema/` are the canonical runtime data model. Convenience functions in `src/llm.ts` are thin constructors that return those same Schema class instances; they should improve callsites without creating a second model.

### Request Flow

The intended callsite is:

```ts
const request = LLM.request({
  model: OpenAI.model("gpt-4o-mini", { apiKey }),
  system: "You are concise.",
  prompt: "Say hello.",
})

const response = yield * LLMClient.generate(request)
```

`LLM.request(...)` builds an `LLMRequest`. `LLMClient.generate(...)` selects a registered route by `request.model.route`, builds the provider-native body, asks the route's transport for a real `HttpClientRequest.HttpClientRequest`, sends it through `RequestExecutor.Service`, parses the provider stream into common `LLMEvent`s, and finally returns an `LLMResponse`.

Use `LLMClient.stream(request)` when callers want incremental `LLMEvent`s. Use `LLMClient.generate(request)` when callers want those same events collected into an `LLMResponse`. Use `LLMClient.prepare<Body>(request)` to compile a request through the route pipeline without sending it — the optional `Body` type argument narrows `.body` to the route's native shape (e.g. `prepare<OpenAIChatBody>(...)` returns a `PreparedRequestOf<OpenAIChatBody>`). The runtime body is identical; the generic is a type-level assertion.

Filter or narrow `LLMEvent` streams with `LLMEvent.is.*` (camelCase guards, e.g. `events.filter(LLMEvent.is.toolCall)`). The kebab-case `LLMEvent.guards["tool-call"]` form also works but prefer `is.*` in new code.

### Routes

A route is the registered, runnable composition of four orthogonal pieces:

- **`Protocol`** (`src/route/protocol.ts`) — semantic API contract. Owns request body construction (`body.from`), the body schema (`body.schema`), the streaming-event schema (`stream.event`), and the event-to-`LLMEvent` state machine (`stream.step`). `Route.make(...)` validates and JSON-encodes the body from `body.schema` and decodes frames with `stream.event`. Examples: `OpenAIChat.protocol`, `OpenAIResponses.protocol`, `AnthropicMessages.protocol`, `Gemini.protocol`, `BedrockConverse.protocol`.
- **`Endpoint`** (`src/route/endpoint.ts`) — path construction. The host always lives on `model.baseURL`; the endpoint just supplies the path. `Endpoint.path("/chat/completions")` is the common case; pass a function for paths that embed the model id or a body field (e.g. `Endpoint.path(({ body }) => `/model/${body.modelId}/converse-stream`)`).
- **`Auth`** (`src/route/auth.ts`) — per-request transport authentication. Routes read `model.apiKey` at request time via `Auth.bearer` (the default; sets `Authorization: Bearer <apiKey>`) or `Auth.apiKeyHeader(name)` for providers that use a custom header (Anthropic `x-api-key`, Gemini `x-goog-api-key`). Routes that need per-request signing (Bedrock SigV4, future Vertex IAM, Azure AAD) implement `Auth` as a function that signs the body and merges signed headers into the result.
- **`Framing`** (`src/route/framing.ts`) — bytes → frames. SSE (`Framing.sse`) is shared; Bedrock keeps its AWS event-stream framing as a typed `Framing<object>` value alongside its protocol.

Compose them via `Route.make(...)`:

```ts
export const route = Route.make({
  id: "openai-chat",
  provider: "openai",
  protocol: OpenAIChat.protocol,
  transport: HttpTransport.httpJson({
    endpoint: Endpoint.path("/chat/completions"),
    auth: Auth.bearer(),
    framing: Framing.sse,
    encodeBody,
  }),
  defaults: {
    baseURL: "https://api.openai.com/v1",
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
})
```

The four-axis decomposition is the reason DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks, and DeepInfra all reuse `OpenAIChat.protocol` verbatim — each provider deployment is a 5-15 line `Route.make(...)` call instead of a 300-400 line route clone. Bug fixes in one protocol propagate to every consumer of that protocol in a single commit.

When a provider ships a non-HTTP transport (OpenAI's WebSocket Responses backend, hypothetical bidirectional streaming APIs), the seam is `Transport` — `WebSocketTransport.json(...)` constructs a transport whose `prepare` builds a WebSocket URL and message and whose `frames` yields decoded text from the socket. Same protocol, different transport.

### URL Construction

`model.baseURL` is required; `Endpoint` only carries the path. Each protocol's `Route.make` includes a canonical URL in `defaults.baseURL` (e.g. `https://api.openai.com/v1`); provider helpers can override by passing `baseURL` in their input. Routes that have no canonical URL (OpenAI-compatible Chat, GitHub Copilot) set `baseURL: string` (required) on their input type so TypeScript catches a missing host at the call site.

For providers where the URL is derived from typed inputs (Azure resource name, Bedrock region), the provider helper computes `baseURL` at model construction time. Use `AtLeastOne<T>` from `route/auth-options.ts` for inputs that accept either of two derivation paths (Azure: `resourceName` or `baseURL`).

### Provider Definitions

Provider-facing APIs are defined with `Provider.make(...)` from `src/provider.ts`:

```ts
export const provider = Provider.make({
  id: ProviderID.make("openai"),
  model: responses,
  apis: { responses, chat },
})

export const model = provider.model
export const apis = provider.apis
```

Keep provider definitions small and explicit:

- Use only `id`, `model`, and optional `apis` in `Provider.make(...)`.
- Use branded `ProviderID.make(...)` and `ModelID.make(...)` where ids are constructed directly.
- Use `model` for the default API path and `apis` for named provider-native alternatives such as OpenAI `responses` versus `chat`.
- Do not add author-facing `kind`, `version`, or `routes` fields.
- Export lower-level `routes` arrays separately only when advanced internal wiring needs them.
- Prefer `apiKey` as provider-specific sugar and `auth` as the explicit override; keep them mutually exclusive in provider option types with `ProviderAuthOption`.
- Resolve `apiKey` → `Auth` with `AuthOptions.bearer(options, "<PROVIDER>_API_KEY")` (it honors an explicit `auth` override and falls back to `Auth.config(envVar)` so missing keys surface a typed `Authentication` error rather than a runtime crash).

Built-in providers are namespace modules from `src/providers/index.ts`, so aliases like `OpenAI.model(...)`, `OpenAI.responses(...)`, and `OpenAI.apis.chat(...)` are fine. External provider packages should default-export the `Provider.make(...)` result and may add named aliases if useful.

### Folder layout

```
packages/llm/src/
  schema/                   canonical Schema model, split by concern
    ids.ts                  branded IDs, literal types, ProviderMetadata
    options.ts              Generation/Provider/Http options, Capabilities, Limits, ModelRef
    messages.ts             content parts, Message, ToolDefinition, LLMRequest
    events.ts               Usage, individual events, LLMEvent, PreparedRequest, LLMResponse
    errors.ts               error reasons, LLMError, ToolFailure
    index.ts                barrel
  llm.ts                    request constructors and convenience helpers
  route/
    index.ts                @opencode-ai/llm/route advanced barrel
    client.ts               Route.make + LLMClient.prepare/stream/generate
    executor.ts             RequestExecutor service + transport error mapping
    protocol.ts             Protocol type + Protocol.make
    endpoint.ts             Endpoint type + Endpoint.path
    auth.ts                 Auth type + Auth.bearer / Auth.apiKeyHeader / Auth.passthrough
    auth-options.ts         ProviderAuthOption shape, AuthOptions.bearer, AtLeastOne helper
    framing.ts              Framing type + Framing.sse
    transport/              transport implementations
      index.ts              Transport type + HttpTransport / WebSocketTransport namespaces
      http.ts               HttpTransport.httpJson — POST + framing
      websocket.ts          WebSocketTransport.json + WebSocketExecutor service
  protocols/
    shared.ts               ProviderShared toolkit used inside protocol impls
    openai-chat.ts          protocol + route (compose OpenAIChat.protocol)
    openai-responses.ts
    anthropic-messages.ts
    gemini.ts
    bedrock-converse.ts
    bedrock-event-stream.ts framing for AWS event-stream binary frames
    openai-compatible-chat.ts route that reuses OpenAIChat.protocol, no canonical URL
    utils/                  per-protocol helpers (auth, cache, media, tool-stream, ...)
  providers/
    openai-compatible.ts    generic compatible helper + family model helpers
    openai-compatible-profile.ts family defaults (deepseek, togetherai, ...)
    azure.ts / amazon-bedrock.ts / github-copilot.ts / google.ts / xai.ts / openai.ts / anthropic.ts / openrouter.ts
  tool.ts                   typed tool() helper
  tool-runtime.ts           implementation helpers for LLMClient tool execution
```

The dependency arrow points down: `providers/*.ts` files import `protocols`, `endpoint`, `auth`, and `framing`; protocols do not import provider metadata. Lower-level modules know nothing about specific providers.

### Shared protocol helpers

`ProviderShared` exports a small toolkit used inside protocol implementations to keep them focused on provider-native shapes:

- `joinText(parts)` — joins an array of `TextPart` (or anything with a `.text`) with newlines. Use this anywhere a protocol flattens text content into a single string for a provider field.
- `parseToolInput(route, name, raw)` — Schema-decodes a tool-call argument string with the canonical "Invalid JSON input for `<route>` tool call `<name>`" error message. Treats empty input as `{}`.
- `parseJson(route, raw, message)` — generic JSON-via-Schema decode for non-tool bodies.
- `eventError(route, message, ...)` — typed `InvalidProviderOutput` constructor for stream-time decode failures.
- `validateWith(decoder)` — maps Schema decode errors to `InvalidRequest`. `Route.make(...)` uses this for body validation; lower-level routes can reuse it.
- `matchToolChoice(provider, choice, branches)` — branches over `LLMRequest["toolChoice"]` for provider-specific lowering.

If you find yourself copying a 3-to-5-line snippet between two protocols, lift it into `ProviderShared` next to these helpers rather than duplicating.

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

Routes lower these into provider-native assistant tool-call messages and tool-result messages. Streaming providers should emit `tool-input-delta` events while arguments arrive, then a final `tool-call` event with parsed input.

### Tool runtime

`LLM.stream({ request, tools })` executes model-requested tools with full type safety. Plain `LLM.stream(request)` only streams the model; if `request.tools` contains schemas, tool calls are returned for the caller to handle. Use `toolExecution: "none"` to pass executable tool definitions as schemas without invoking handlers. Add `stopWhen` to opt into follow-up model rounds after tool results.

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

const events = yield* LLM.stream({
  request,
  tools: { get_weather, get_time, ... },
  stopWhen: LLM.stepCountIs(10),
}).pipe(Stream.runCollect)
```

The runtime:

- Adds tool definitions (derived from each tool's `parameters` Schema via `Schema.toJsonSchemaDocument`) onto `request.tools`.
- Streams the model.
- On `tool-call`: looks up the named tool, decodes input against `parameters` Schema, dispatches to the typed `execute`, encodes the result against `success` Schema, emits `tool-result`.
- Emits local `tool-result` events in the same step by default.
- Loops only when `stopWhen` is provided and the step finishes with `tool-calls`, appending the assistant + tool messages.

Handler dependencies (services, permissions, plugin hooks, abort handling) are closed over by the consumer at tool-construction time. The runtime's only environment requirement is `RequestExecutor.Service`. Build the tools record inside an `Effect.gen` once and reuse it across many runs.

Errors must be expressed as `ToolFailure`. The runtime catches it and emits a `tool-error` event, then a `tool-result` of `type: "error"`, so the model can self-correct on the next step. Anything that is not a `ToolFailure` is treated as a defect and fails the stream. Three recoverable error paths produce `tool-error` events:

- The model called an unknown tool name.
- Input failed the `parameters` Schema.
- The handler returned a `ToolFailure`.

Provider-defined / hosted tools (Anthropic `web_search` / `code_execution` / `web_fetch`, OpenAI Responses `web_search_call` / `file_search_call` / `code_interpreter_call` / `mcp_call` / `local_shell_call` / `image_generation_call` / `computer_use_call`) pass through the runtime untouched:

- Routes surface the model's call as a `tool-call` event with `providerExecuted: true`, and the provider's result as a matching `tool-result` event with `providerExecuted: true`.
- The runtime detects `providerExecuted` on `tool-call` and **skips client dispatch** — no handler is invoked and no `tool-error` is raised for "unknown tool". The provider already executed it.
- Both events are appended to the assistant message in `assistantContent` so the next round's history carries the call + result for context. Anthropic encodes them back as `server_tool_use` + `web_search_tool_result` (or `code_execution_tool_result` / `web_fetch_tool_result`) blocks; OpenAI Responses callers typically use `previous_response_id` instead of resending hosted-tool items.

Add provider-defined tools to `request.tools` (no runtime entry needed). The matching route must know how to lower the tool definition into the provider-native shape; right now Anthropic accepts `web_search` / `code_execution` / `web_fetch` and OpenAI Responses accepts the hosted tool names listed above.

## Protocol File Style

Protocol files should look self-similar. Provider quirks belong behind named helpers so a new route can be reviewed by comparing the same sections across files.

### Section order

Use this order for every protocol module:

1. Public model input
2. Request body schema
3. Streaming event schema
4. Parser state
5. Request body construction (`fromRequest`)
6. Stream parsing (`step` and per-event handlers)
7. Protocol and route
8. Model helper

### Rules

- Keep protocol files focused on the protocol. Move provider-specific projection, signing, media normalization, or other bulky transformations into `src/protocols/utils/*`.
- Use `Effect.fn("Provider.fromRequest")` for request body construction entrypoints. Use `Effect.fn(...)` for event handlers that yield effects; keep purely synchronous handlers as plain functions returning a `StepResult` that the dispatcher lifts via `Effect.succeed(...)`.
- Parser state owns terminal information. The state machine records finish reason, usage, and pending tool calls; emit one terminal `request-finish` (or `provider-error`) when a `terminal` event arrives. If a provider splits reason and usage across events, merge them in parser state before flushing.
- Emit exactly one terminal `request-finish` event for a completed response. Use `stream.terminal` to signal the run is over and have `step` emit the final event.
- Use shared helpers for repeated protocol policy such as text joining, usage totals, JSON parsing, and tool-call accumulation. `ToolStream` (`protocols/utils/tool-stream.ts`) accumulates streamed tool-call arguments uniformly.
- Make intentional provider differences explicit in helper names or comments. If two protocol files differ visually, the reason should be obvious from the names.
- Prefer dispatched per-event handlers (`onMessageStart`, `onContentBlockDelta`, ...) called from a small top-level `step` switch over a long if-chain. The dispatcher keeps the event surface visible at a glance.
- Keep tests in the same conceptual order as the protocol: basic prepare, tools prepare, unsupported lowering, text/usage parsing, tool streaming, finish reasons, provider errors.

### Review checklist

- Can the file be skimmed side-by-side with `openai-chat.ts` without hunting for equivalent sections?
- Are provider quirks named, isolated, and covered by focused tests?
- Does request body construction validate unsupported common content at the protocol boundary?
- Does stream parsing emit stable common events without leaking provider event order to callers?
- Does `toolChoice: "none"` behavior read as intentional?

## Recording Tests

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

Pass `provider`, `protocol`, and optional `tags` to `recordedTests(...)` / `recorded.effect.with(...)` so cassettes carry searchable metadata. Use recorded-test filters to replay or record a narrow subset without rewriting a whole file:

- `RECORDED_PROVIDER=openai` matches tests tagged with `provider:openai`; comma-separated values are allowed.
- `RECORDED_PREFIX=openai-chat` matches cassette groups by `recordedTests({ prefix })`; comma-separated values are allowed.
- `RECORDED_TAGS=tool` requires all listed tags to be present, e.g. `RECORDED_TAGS=provider:togetherai,tool`.
- `RECORDED_TEST="streams text"` matches by test name, kebab-case test id, or cassette path.

Filters apply in replay and record mode. Combine them with `RECORD=true` when refreshing only one provider or scenario.

**Binary response bodies.** Most providers stream text (SSE, JSON). AWS Bedrock streams binary AWS event-stream frames whose CRC32 fields would be mangled by a UTF-8 round-trip — those bodies are stored as base64 with `bodyEncoding: "base64"` on the response snapshot. Detection is by `Content-Type` in `@opencode-ai/http-recorder` (currently `application/vnd.amazon.eventstream` and `application/octet-stream`); cassettes for SSE/JSON routes omit the field and decode as text.

**Matching strategy.** Replay walks the cassette in record order via an internal cursor: the Nth runtime request is served by the Nth recorded interaction, and each one is validated by comparing method, URL, allow-listed headers, and the canonical JSON body. This handles tool loops (each round's request differs as history grows) and retry/polling scenarios (successive byte-identical requests with different responses) uniformly. If a test reorders its requests, re-record the cassette. `scriptedResponses` (in `test/lib/http.ts`) is the deterministic counterpart for tests that don't need a live provider; it scripts response bodies in order without reading from disk.

Do not blanket re-record an entire test file when adding one cassette. `RECORD=true` rewrites every recorded case that runs, and provider streams contain volatile IDs, timestamps, fingerprints, and obfuscation fields. Prefer deleting the one cassette you intend to refresh, or run a focused test pattern that only registers the scenario you want to record. Keep stable existing cassettes unchanged unless their request shape or expected behavior changed.
