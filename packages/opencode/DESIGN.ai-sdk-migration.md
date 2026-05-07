# AI SDK → `@opencode-ai/llm` Migration

## Goal

Move opencode off Vercel's AI SDK (`ai`, `@ai-sdk/<vendor>`, third-party SDK adapters) onto our in-house `@opencode-ai/llm`.

End state: `ai` and `@ai-sdk/*` removed from `package.json`. Every model call goes through `@opencode-ai/llm`.

No flag day. Each phase is shippable, no behavior change unless explicitly noted.

## Today

- `provider/provider.ts` — `Provider.Service.getLanguage(model): LanguageModelV3`. Returns the AI SDK's executable runtime model. `BUNDLED_PROVIDERS` dynamically imports each `@ai-sdk/<vendor>` package.
- `session/llm.ts` — `LLM.Service.stream(input) → Stream<Event>`. The only file that calls `streamText` / `wrapLanguageModel`. Has a gated `runNative` path that uses `@opencode-ai/llm` end-to-end (via `session/llm-native.ts`, `llm-native-events.ts`, `llm-native-tools.ts`, `provider/llm-bridge.ts`). Native is currently behind `OPENCODE_EXPERIMENTAL_LLM_NATIVE` and only enabled for `anthropic-messages`.
- AI SDK types leak into 11+ files outside `session/llm.ts`: `provider/transform.ts` (~1200 lines of message rewriting), `session/message-v2.ts` (~1221 lines, branches on `model.api.npm`), `session/prompt.ts`, `session/llm-native-tools.ts`, `agent/agent.ts`, `mcp/index.ts`, `provider/sdk/copilot/*` (a fork of `@ai-sdk/openai-compatible`), and others.

## Plan

### Phase 1 — `Provider.getModelHandle`: discriminated-union return type

The first move. Tiny surface change, makes the rest of the migration possible.

Today `getLanguage` returns `LanguageModelV3` (an AI SDK runtime object). We can't just swap it for `ModelRef` because that's a description, not an executable.

Add a new method `getModelHandle` returning a discriminated union:

```ts
type ModelHandle =
  | { kind: "ai-sdk", language: LanguageModelV3 }
  | { kind: "native", ref: ModelRef }

Provider.Service.getModelHandle(model): Effect<ModelHandle, NoSuchModelError>
```

Phase 1 is intentionally a parallel addition. Existing `getLanguage` keeps working; new code consumes `getModelHandle`. The union is the migration vehicle — it's deliberately ugly so it's obvious it's temporary. Once AI SDK is gone, the union collapses to `{ ref: ModelRef }`.

Steps:

1. Add `getModelHandle` to `Provider.Service` (parallel to `getLanguage`). The native arm calls into `provider/llm-bridge.ts:toModelRef`. The AI SDK arm wraps `getLanguage`.
2. Move AI SDK plumbing (`BUNDLED_PROVIDERS`, dynamic imports) to a new `provider/sdk-resolver.ts`. `provider/provider.ts` consumes it.
3. Switch the *one* caller in `session/llm.ts` to consume `getModelHandle`. The fork it does today (`runNative` vs `run`) becomes a switch on `handle.kind`.

After Phase 1: backend choice is encoded in the return type, not in a per-request gate.

### Phase 2 — Decouple AI SDK types from the rest of opencode

Pull AI SDK imports out of every file that isn't `session/llm.ts` or `provider/sdk-resolver.ts`. No behavior change.

In rough order of pain:

1. `provider/error.ts` — opencode-owned `ProviderError` shape `{ status, message, isRetryable, providerID, responseBody }`. Adapter constructors `fromAPICallError(e)` and `fromLLMError(e)`. Removes `APICallError` from `acp/agent.ts`.
2. `session/prompt.ts:resolveTools` — `Tool.Def` becomes the canonical tool type. Convert to AI SDK `Tool` lazily inside the AI SDK adapter, not eagerly here. Drops `tool` / `jsonSchema` / `asSchema` imports from prompt.ts.
3. `session/message-v2.ts` — add `toLLMMessagesEffect` parallel to `toModelMessagesEffect`. Both convert from the same `MessageV2.WithParts[]` source. Reuse `session/llm-native.ts`.
4. `session/session.ts` — replace `ProviderMetadata` / `LanguageModelUsage` imports with opencode-owned types. Cosmetic but removes the leak.
5. `mcp/index.ts` — emit `Tool.Def` alongside the existing `dynamicTool`. Once both exist, the native gate can keep MCP tools.
6. `agent/agent.ts:generateObject/streamObject` — keep on AI SDK for now (structured output isn't on `@opencode-ai/llm` yet); isolate to one `LLM.generateObject(input, schema)` Service method so the AI SDK call site is in one place.

### Phase 3 — Lift `prepare()` out of `session/llm.ts`

`prepare()` is backend-agnostic: system messages, plugin hooks (`chat.params`, `chat.headers`), tool resolution, header building. Today it's mixed in with `run()` (the AI SDK call). Lift to `session/llm-prepare.ts`. Both backends consume the result.

Pure refactor. No behavior change.

### Phase 4 — Split `LLM.Service.live` into two layers

```
session/backends/ai-sdk.ts   — current run() extracted
session/backends/native.ts   — current runNative() extracted, no gate
```

`LLM.Service.layer` selects based on a single config flag at construction:

```ts
Config.experimental?.llmBackend ?? "ai-sdk"  // "ai-sdk" | "native"
```

One decision point. No per-request gate. The decision is global. Drop `NATIVE_ROUTES` allowlist and `runNative`'s gate conditions; they were guards for a half-built path that's about to be all-or-nothing.

### Phase 5 — Native parity

What `@opencode-ai/llm` needs before native can be the default:

- Per-route stabilization tests (anthropic-messages → bedrock-converse → openai-responses → openai-chat / openai-compatible-chat → gemini → openrouter-chat).
- Provider options pass-through. Either accept opaque per-request `providerOptions` in `LLMRequest` and lower per protocol, or move all known options (reasoning effort, prompt cache key, text verbosity, OpenRouter usage/reasoning) onto `LLM.ModelRef`.
- Retry support in `RequestExecutor` subsuming `streamText({ maxRetries })`.
- OpenTelemetry tracing in `RequestExecutor`, gated by config.
- MCP tool dispatch on the native path (likely already works — `runWithTools` accepts AI SDK `Tool`).
- Structured output: either port `generateObject` semantics, or keep AI SDK as the structured-output fallback indefinitely.
- GitLab workflow provider: custom WebSocket transport with server-side tool execution. Write a `@opencode-ai/llm` route + transport (the existing `WebSocketTransport.json` precedent applies).

What opencode-side adapter still needs:

- `experimental_repairToolCall` lowercase fixup → middleware in the native path.
- `_noop` stub tool injection for LiteLLM/Copilot proxies → either to `@opencode-ai/llm/providers/openai-compatible` profile or kept in `prepare`.
- OpenAI OAuth `instructions` quirk → encode on the OpenAI provider in `@opencode-ai/llm`.

### Phase 6 — Per-provider rollout

- Default flag stays `ai-sdk`. Internal/CI runs `native`.
- Per-provider opt-in: `Config.experimental.llmBackend.providers = ["anthropic", "bedrock"]`.
- Telemetry compares finish reasons, token usage, latency, error rates. Soak each provider until comparison is boring.

### Phase 7 — Delete the AI SDK

1. Delete `provider/sdk/copilot/*` — replaced by `@opencode-ai/llm/providers/github-copilot`.
2. Shrink `provider/transform.ts` to opencode-policy bits only (max output tokens, temperature defaults, topK). Provider-specific message rewriting lives in protocol lowering inside `@opencode-ai/llm`.
3. Delete `BUNDLED_PROVIDERS` and `provider/sdk-resolver.ts`. `getLanguage` removed.
4. Collapse the `ModelHandle` discriminated union to `{ ref: ModelRef }` (or simplify back to a metadata-only Provider).
5. Delete `session/llm.ts:run` (the `streamText` call) and `session/backends/ai-sdk.ts`. `LLM.Service` is the native path.
6. Remove `ai`, `@ai-sdk/*`, `@openrouter/ai-sdk-provider`, `gitlab-ai-provider`, `venice-ai-sdk-provider` from `package.json`.
7. Convert `Event = streamText.fullStream` element type to a named `LLM.SessionEvent` schema.

## Order to execute

1. Phase 1 (model handle) — small, mechanical, unlocks everything.
2. Phase 2 (decouple types) — most of the actual work, but each step is a clean PR.
3. Phase 3 (lift prepare) — small, pure refactor.
4. Phase 4 (split layers) — flips the architecture even if native isn't ready yet.
5. Phase 5 (parity) — the real grind. Item-by-item.
6. Phase 6 (rollout) — per-provider, telemetry-gated.
7. Phase 7 (delete) — celebratory.

## Risks

- **Telemetry parity.** AI SDK emits OTel spans for every model call. Native path has no equivalent. Block flag-flipping until parity.
- **Token usage normalization.** `LLM.Usage` and `LanguageModelUsage` are similar but not identical (cache write tokens, reasoning tokens). Audit before flipping.
- **Provider-executed tools.** Anthropic `web_search`/`code_execution`/`web_fetch` and OpenAI Responses hosted tools work end-to-end on the native path. Verify per provider on a recorded scenario before promoting.
- **`Tool.Def` cutover.** Canonicalizing on `Tool.Def` ripples through `prompt.ts`, `mcp/index.ts`, `agent/agent.ts`. Keep both shapes alive during Phase 2; choose the cutover point deliberately.
- **GitLab workflow.** Custom WebSocket protocol with custom tool execution / approval flow. Re-implementing it as a `@opencode-ai/llm` route is its own design exercise.
- **Structured output.** `agent/agent.ts:generateObject` may be the longest-lived AI SDK call site if we don't add structured-output support to `@opencode-ai/llm` first.
