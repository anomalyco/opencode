# AI SDK → `@opencode-ai/llm` Migration

## Problem

`opencode` currently runs every model call through Vercel's AI SDK (`ai`, `@ai-sdk/<vendor>`, plus a few third-party SDK adapters). Over time the in-house `@opencode-ai/llm` library has matured into a clean, Effect-Schema-first replacement: routes, protocols, transports, body schemas, typed events, tool runtime — all of it.

We want to move opencode off the AI SDK without a flag day. The end state is the AI SDK gone from `opencode`'s `package.json` and every model call going through `@opencode-ai/llm`. The journey is incremental, behind a feature flag, with telemetry-driven rollout per provider.

This document captures the current architecture, the target architecture, and the phased plan to get from one to the other.

## Today: how opencode integrates the AI SDK

### Boundary surface

Two layers do the heavy lifting:

- **`provider/provider.ts`** — `BUNDLED_PROVIDERS` map dynamically `import()`s each `@ai-sdk/<vendor>` package. `Provider.Service.getLanguage(model)` returns a `LanguageModelV3` from `@ai-sdk/provider`. Custom per-provider quirks (auth, OAuth, Vertex, Copilot, Gateway, SSE-timeout via `wrapSSE`) live here.
- **`session/llm.ts`** — the **only** file that calls `streamText` / `wrapLanguageModel`. `LLM.Service.stream(input) → Stream<Event>` is the seam everything above speaks to. `Event` is the AI SDK `streamText.fullStream` element type re-exported as opencode's session event vocabulary.

```
┌─────────────────────────────────────────────────────────┐
│  session/prompt.ts                                      │
│  agent/agent.ts                                         │
│  session/processor.ts                                   │
│              │                                          │
│              ▼                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LLM.Service.stream(input) → Stream<Event>       │   │
│  │  (session/llm.ts)                                │   │
│  └──────────────────────────────────────────────────┘   │
│              │                                          │
│              ▼                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  prepare()       — system msgs, plugins,         │   │
│  │                    headers, tool resolution      │   │
│  │  run()           — streamText(...)               │   │
│  │  runNative()     — gated experimental path       │   │
│  └──────────────────────────────────────────────────┘   │
│              │                       │                  │
│              ▼                       ▼                  │
│  ┌─────────────────────┐  ┌─────────────────────────┐   │
│  │  AI SDK             │  │  @opencode-ai/llm       │   │
│  │  streamText({...})  │  │  LLMClient.stream(...)  │   │
│  │  + GitLab WS quirks │  │  via                    │   │
│  │  + OAuth quirks     │  │  llm-native.ts +        │   │
│  │  + ProviderTransform│  │  llm-native-events.ts   │   │
│  │                     │  │  + llm-native-tools.ts  │   │
│  └─────────────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

At the top, the API is already a single service. The mess is **below** that line — in 11+ files where AI SDK types leak.

### Trace one `streamText` call

1. `session/prompt.ts:1597` calls `handle.process({ user, agent, system, messages, tools, nativeTools, nativeMessages, model, ... })`.
2. `processor.create` → `processor.process` → `llm.stream(streamInput)` (`session/processor.ts:670`).
3. `LLM.Service.stream` (`session/llm.ts:592`):
   - `prepare(request)` — resolves `LanguageModelV3` via `Provider.getLanguage`, builds system messages, applies `Plugin.trigger("chat.params"/"chat.headers")`, runs `ProviderTransform.providerOptions/options/temperature/...`, filters tools through `Permission`, may inject `_noop` stub tool for LiteLLM/Copilot.
   - `runNative(request, prepared)` — returns a `Stream` if the gate passes, else `undefined`.
   - `run(request, prepared)` — `streamText({ model: wrapLanguageModel({ model, middleware: [{ transformParams: ProviderTransform.message }] }), tools, providerOptions, ... })`.
4. `Stream.fromAsyncIterable(result.fullStream)` is consumed by `processor.handleEvent` (switch on `text-start` / `tool-call` / `finish-step` / etc.) which writes `MessageV2.Part`s back into the session store.

### Existing native path (gated, partial)

A second backend already runs behind `OPENCODE_EXPERIMENTAL_LLM_NATIVE`. It uses `@opencode-ai/llm` end to end. Three small files hold all the conversion:

- `session/llm-native.ts` — `MessageV2.WithParts[] → LLMRequest`. Handles message lowering, cache hint placement, tool-definition lowering. Errors on unsupported content / model.
- `session/llm-native-events.ts` — stateful per-stream `mapper()` that converts `LLMEvent → SessionEvent` (the AI SDK fullStream shape opencode already speaks). Tracks open IDs so `*-end` events can synthesize on stream close.
- `session/llm-native-tools.ts` — multi-round client-side tool dispatch loop. Forks each `tool-call` event into a fiber, runs the AI SDK `tool.execute(...)`, injects synthetic `tool-result`/`tool-error` `LLMEvent` back into the stream, drives subsequent rounds.
- `provider/llm-bridge.ts` — `Provider.Model → LLM.ModelRef`, dispatching on `model.api.npm`.

### What blocks `runNative` today

Every condition below must hold for a request to take the native path. Anything else falls through to AI SDK:

```
Flag.OPENCODE_EXPERIMENTAL_LLM_NATIVE === true
    && nativeMessages provided (caller populated MessageV2.WithParts)
    && retries === 0
    && experimental.openTelemetry === false
    && prepared.params.options is empty (no provider-specific knobs)
    && every AI-SDK tool key has a matching nativeTools entry
    && LLMNative.request didn't throw UnsupportedContentError / UnsupportedModelError
    && model.route ∈ NATIVE_ROUTES   // currently {"anthropic-messages"} only
```

## Where the spaghetti actually is

The integration is "spaghetti" not at the top boundary (which is already a clean Service), but in the type leakage **below** that boundary.

### AI SDK type leakage outside `session/llm.ts`

| File | Leaked AI SDK types | Why |
|---|---|---|
| `provider/provider.ts` | `LanguageModelV3`, `Provider as SDK`, `NoSuchModelError` | `getLanguage` returns `LanguageModelV3`; `BUNDLED_PROVIDERS` returns AI SDK factories |
| `provider/transform.ts` (~1200 lines) | `ModelMessage`, `JSONSchema7` | All `ProviderTransform.message/options/providerOptions/...` operate on `ModelMessage[]` |
| `provider/error.ts` | `APICallError` | Provider-specific error classification on AI SDK error shape |
| `session/message-v2.ts` (~1221 lines) | `APICallError`, `convertToModelMessages`, `LoadAPIKeyError`, `ModelMessage`, `UIMessage` | `MessageV2.toModelMessagesEffect` converts V2-parts → AI SDK `ModelMessage[]`, branches on `model.api.npm` |
| `session/prompt.ts` | `Tool`, `tool`, `jsonSchema`, `ToolExecutionOptions`, `asSchema`, `JSONSchema7` | `resolveTools` builds AI SDK `Tool` record; `createStructuredOutputTool` builds `tool({...})` |
| `session/llm-native-tools.ts` | `Tool`, `ToolExecutionOptions` | Native multi-round dispatcher invokes AI SDK `tool.execute(...)` at the leaves |
| `session/session.ts` | `ProviderMetadata`, `LanguageModelUsage` | Type leakage on stored session shapes |
| `agent/agent.ts` | `generateObject`, `streamObject`, `ModelMessage` | `Agent.generate` is a separate AI SDK call site for structured-output config generation |
| `acp/agent.ts` | `LoadAPIKeyError` | error classification only |
| `mcp/index.ts` | `dynamicTool`, `Tool`, `jsonSchema`, `JSONSchema7` | MCP tools are exclusively AI SDK shape today |

### Provider-specific transforms scattered

- `provider/transform.ts` (1200 lines) — message rewriting, `providerOptions` remapping, DeepSeek reasoning fixup, Anthropic empty-content filter, cache key handling.
- `session/message-v2.ts:746-750` — branches on `model.api.npm` for cache-on/off detection.
- `provider/llm-bridge.ts:130-137` — capabilities derived from `protocol` string.
- `session/llm.ts:175-189` — `isWorkflow` / `isOpenaiOauth` message-shaping branches.

### `provider/sdk/copilot/*` — a private fork

This subdirectory is a fork of `@ai-sdk/openai-compatible` adapted for GitHub Copilot (chat + responses endpoints, custom tool prep, custom error mapping). Lazy-loaded only for `@ai-sdk/github-copilot`. Its responsibilities — protocol selection, tool lowering, error mapping — already exist in `@opencode-ai/llm/providers/github-copilot`. Once Copilot is stable on the native path, the entire subdirectory deletes.

### MessageV2 ↔ AI SDK duplication

`session/message-v2.ts:toModelMessagesEffect` and `session/llm-native.ts` both convert `MessageV2.WithParts[]`. One produces `ModelMessage[]` (AI SDK), the other produces `LLM.Message[]` (native). Both are largely complete; they diverge on cache markers, provider-executed tools, file-URL handling, synthetic-tail message support.

## Target architecture

```
┌─────────────────────────────────────────────────────────┐
│  session/prompt.ts, agent/agent.ts, ...                 │
│  Speak only opencode-owned types:                       │
│    - Tool.Def (not AI SDK Tool)                         │
│    - ProviderError (not APICallError)                   │
│    - SessionEvent (named, not fullStream type alias)    │
│    - MessageV2.WithParts                                │
│              │                                          │
│              ▼                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LLM.Service.stream(input) → Stream<SessionEvent>│   │
│  └──────────────────────────────────────────────────┘   │
│              │                                          │
│              ▼                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  prepare()    — backend-agnostic                 │   │
│  │  (session/llm-prepare.ts)                        │   │
│  │  • system messages                               │   │
│  │  • plugin hooks (chat.params, chat.headers)      │   │
│  │  • tool resolution (Tool.Def)                    │   │
│  │  • header building                               │   │
│  └──────────────────────────────────────────────────┘   │
│              │                                          │
│              ▼                                          │
│         (one flag, one decision)                        │
│                                                          │
│  Config.experimental.llmBackend ∈ {"ai-sdk","native"}   │
│                                                          │
│       ┌──────────────────────┴──────────────────────┐   │
│       ▼                                             ▼   │
│  ┌────────────────────┐                ┌──────────────┐ │
│  │ Service.aiSdkLayer │                │ Service.     │ │
│  │ session/backends/  │                │ nativeLayer  │ │
│  │   ai-sdk.ts        │                │ session/     │ │
│  │ • streamText        │               │ backends/    │ │
│  │ • GitLab WS quirks  │               │   native.ts  │ │
│  │ • OAuth quirks      │               │ • LLMClient. │ │
│  └────────────────────┘                │   stream     │ │
│                                         │ • mapper()   │ │
│                                         │ • runWith    │ │
│                                         │   Tools      │ │
│                                         └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

The flag lives at **layer construction time**. No per-request gate. Either backend handles every request opencode sends.

## Phased migration

### Phase A — Decouple

Pull AI SDK types out of every non-`session/llm.ts` module. **No behavior change.** Each step is a small refactor with green tests at the end.

1. **`provider/provider.ts`** — stop returning `LanguageModelV3` from `getLanguage`. Introduce `Provider.getModelHandle(model): { kind: "ai-sdk", model: LanguageModelV3 } | { kind: "native", ref: ModelRef }`. AI SDK plumbing moves into `provider/sdk-resolver.ts` (new file). `BUNDLED_PROVIDERS` moves there.
2. **`provider/error.ts`** — opencode-owned `ProviderError` shape `{ status, message, isRetryable, providerID, responseBody }`. Adapter constructors `fromAPICallError(e)` and `fromLLMError(e: LLMError)`. Removes `APICallError` import from `acp/agent.ts` and most of `provider/error.ts`.
3. **`session/message-v2.ts`** — add `toLLMMessagesEffect` parallel to `toModelMessagesEffect`. Both produced from the same `MessageV2.WithParts[]`. Reuse `session/llm-native.ts` lowering. `ModelMessage` storage shapes (`session.ts:7`) become opencode-owned types.
4. **`session/prompt.ts:resolveTools`** — `Tool.Def` is the canonical tool type. Convert `Tool.Def → AI SDK Tool` lazily inside the AI SDK adapter, not eagerly here. Removes `tool` / `jsonSchema` / `asSchema` imports.
5. **`mcp/index.ts`** — add MCP → `Tool.Def` lowering alongside `dynamicTool`. Once both shapes exist, native gate can keep MCP tools.
6. **`agent/agent.ts:generateObject/streamObject`** — keep on AI SDK for now (structured output isn't on `@opencode-ai/llm` yet); isolate to `LLM.generateObject(input, schema)` Service method so the AI SDK call site is in one place.

### Phase B — Service-level swap

Rewrite `session/llm.ts` so the backend is selected once, at layer construction.

1. Keep `Interface.stream: (input: StreamInput) => Stream.Stream<SessionEvent, unknown>` as the public surface (already opencode-owned).
2. Split `live` into two layers:
   - `Service.aiSdkLayer` — current `prepare/run` extracted, wraps `streamText` + GitLab/OpenAI-OAuth quirks + monkey-patching.
   - `Service.nativeLayer` — current `runNative` extracted, calls `llmClient.stream` via `LLMNativeTools.runWithTools`. Translates events with `LLMNativeEvents.mapper`.
3. `defaultLayer` selects based on a single `Config.experimental?.llmBackend ?? "ai-sdk"`. **One decision point. No per-request gate.**
4. The `prepare` function is **shared infrastructure**, not AI-SDK-specific. Lift to `session/llm-prepare.ts`. Both backends consume the resulting `PreparedStream`.

### Phase C — Native parity

What `@opencode-ai/llm` needs:

- **Drop the `NATIVE_ROUTES` allowlist**. Add per-route stabilization tests. Order: anthropic-messages (done) → bedrock-converse → openai-responses → openai-chat / openai-compatible-chat → gemini → openrouter-chat.
- **Provider options pass-through**. `LLMRequest` carries opaque per-request `providerOptions`; each protocol lowers what it knows. Or move all known options (reasoning effort, prompt cache key, text verbosity, OpenRouter usage/reasoning) onto `LLM.ModelRef` (mostly done in `llm-bridge.ts`) so per-request options become unnecessary.
- **Retry support** in `RequestExecutor` subsuming `streamText({ maxRetries })`.
- **OpenTelemetry tracing** in `RequestExecutor`, gated by the same config flag.
- **MCP tool support**. Either teach MCP to emit `Tool.Def`, or teach `LLMNativeTools.runWithTools` to dispatch raw AI SDK tools (it already does — `tools: Record<string, Tool>`).
- **Structured output**. Either port `generateObject` semantics onto `@opencode-ai/llm`, or keep AI SDK as the structured-output fallback indefinitely.
- **GitLab workflow provider**. Custom WebSocket transport with server-side tool execution. Write a `@opencode-ai/llm` route + transport for it (the existing `WebSocketTransport.json` precedent applies).

What opencode-side adapter still needs:

- `experimental_repairToolCall` lowercase fixup → middleware in the native path.
- `_noop` stub tool injection for LiteLLM/Copilot proxies → either move to `@opencode-ai/llm/providers/openai-compatible` profile, or keep in `prepare`.
- OpenAI OAuth `instructions` quirk → encode on the OpenAI provider in `@opencode-ai/llm`.

### Phase D — Flag-driven rollout

- Default `ai-sdk`. Internal/CI runs `native`.
- Per-provider opt-in: `Config.experimental.llmBackend.providers = ["anthropic", "bedrock"]` so we can flip Anthropic to native while leaving openai-compatible on AI SDK.
- Telemetry compares finish reasons, token usage, latency, error rates per session.
- Soak each provider until the comparison is boring.

### Phase E — Delete the AI SDK

Once native covers all routes + structured output:

1. Delete `provider/sdk/copilot/*` — replaced by `@opencode-ai/llm/providers/github-copilot`.
2. Shrink `provider/transform.ts` to opencode-policy bits only (max output tokens, temperature defaults, topK). The provider-specific message rewriting lives in protocol lowering inside `@opencode-ai/llm`.
3. Delete `BUNDLED_PROVIDERS` from `provider/provider.ts`. `getLanguage` removed.
4. Delete `session/llm.ts:run` and the `streamText` call. Keep `stream` and `prepare`.
5. Remove `ai`, `@ai-sdk/*`, `@openrouter/ai-sdk-provider`, `gitlab-ai-provider`, `venice-ai-sdk-provider` from `package.json`.
6. Convert `Event = streamText.fullStream` element type to a named `LLM.SessionEvent` schema.

## Suggested execution order

1. **Now** — lift `prepare` into a shared module; make `LLM.Service` interface fully opencode-typed (Phase A.1, A.2, B.1–B.2). Low risk, no behavior change.
2. **Next** — drop `NATIVE_ROUTES` allowlist; flip stabilization tests on per-route in `@opencode-ai/llm`. Add per-provider native opt-in flag (Phase B.3, D partial).
3. **Then** — MCP + structured output + retry/OTel parity (Phase C). These unblock most real sessions.
4. **Then** — GitLab workflow + Copilot. These eliminate the largest forks.
5. **Finally** — flip default, soak, delete AI SDK (Phase E).

## Key files to touch first

- `packages/opencode/src/session/llm.ts` — split `live` into two layers; extract `prepare`.
- `packages/opencode/src/provider/provider.ts` — split AI SDK plumbing into `provider/sdk-resolver.ts`; narrow `Service.Interface`.
- `packages/opencode/src/provider/error.ts` — opencode-owned `ProviderError` shape.
- `packages/opencode/src/session/message-v2.ts` — add `toLLMMessagesEffect`; eliminate `@ai-sdk/*` branches.
- `packages/opencode/src/session/prompt.ts` — `Tool.Def` as canonical, not AI SDK `tool()`.
- `packages/opencode/src/session/llm-native.ts` and `llm-native-events.ts` — already clean, become *the* path.
- `packages/opencode/src/provider/llm-bridge.ts` — extend with anything currently in `ProviderTransform.providerOptions` that doesn't already have a `ProviderOptions` mapping.
- `packages/llm/src/providers/*.ts` — ensure each provider exposes the per-request options that `provider/transform.ts:providerOptions` produces.

## Risks and open questions

- **Telemetry parity.** Today AI SDK emits OTel spans for every model call. Native path has no equivalent. We need parity before flag-flipping or rollout is blind.
- **Token usage normalization.** Each protocol's `mapUsage` produces an `LLM.Usage`; AI SDK produces `LanguageModelUsage`. The shapes are similar but not identical (cache write tokens, reasoning tokens). Audit before flipping.
- **Provider-executed tools.** Anthropic `web_search`/`code_execution`/`web_fetch` and OpenAI Responses hosted tools work end-to-end on the native path. Verify on a recorded scenario per provider before promoting.
- **Tool.Def vs AI SDK `Tool`.** The decision to canonicalize on `Tool.Def` ripples through `prompt.ts`, `mcp/index.ts`, `agent/agent.ts`. Keep both shapes alive during Phase A; choose the cutover point deliberately.
- **`session/message-v2.ts` is huge.** 1221 lines of conversion logic. The `toLLMMessagesEffect` addition is non-trivial; plan a dedicated PR.
- **GitLab workflow.** It's a custom WebSocket protocol with custom tool execution / approval flow. Re-implementing it as a `@opencode-ai/llm` route is its own design exercise.
- **Structured output.** `generateObject` in `agent/agent.ts` may be the longest-lived AI SDK call site if we don't add structured-output support to `@opencode-ai/llm` first.
