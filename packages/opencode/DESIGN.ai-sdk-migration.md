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

Goal: AI SDK imports only appear in `session/llm.ts` and `provider/sdk-resolver.ts`. Every other file speaks opencode-owned types. No behavior change.

Each step adds one new opencode type, replaces the AI SDK one at the boundary, and uses an adapter at the actual AI SDK call site.

#### 2a — `ProviderError` (replaces `APICallError`, `LoadAPIKeyError`)

Today: `provider/error.ts` imports `APICallError` and exposes `parseAPICallError(input: { providerID, error: APICallError })`. `session/message-v2.ts` calls `APICallError.isInstance(e)` / `LoadAPIKeyError.isInstance(e)` to classify thrown errors. `acp/agent.ts` checks `LoadAPIKeyError.isInstance(error)` in 5+ places to surface auth-config errors to the user.

New shape:

```ts
// packages/opencode/src/provider/error.ts
export interface ProviderError {
  readonly providerID: ProviderID
  readonly kind: "api-call" | "missing-credentials" | "transport"
  readonly message: string
  readonly status?: number       // HTTP status if known
  readonly responseBody?: string // redacted body for diagnostics
  readonly retryable: boolean
}

export const fromAPICallError = (input: { providerID: ProviderID; error: APICallError }): ProviderError
export const fromLoadAPIKeyError = (input: { providerID: ProviderID; error: LoadAPIKeyError }): ProviderError
export const fromLLMError = (input: { providerID: ProviderID; error: LLMError }): ProviderError  // for native path
```

Migration: `parseAPICallError` keeps its body but returns `ProviderError`. `acp/agent.ts` checks `error.kind === "missing-credentials"` instead of `LoadAPIKeyError.isInstance`. `session/message-v2.ts` keeps the `APICallError.isInstance` switch but uses it only inside the AI SDK adapter; the rest of message-v2 takes a `ProviderError`.

#### 2b — `Tool.Def` as the canonical tool type

Today: `session/prompt.ts:resolveTools` imports `tool`, `jsonSchema`, `asSchema`, `ToolExecutionOptions`, `Tool as AITool` from `ai` and builds a `Record<string, AITool>` for `streamText`. `mcp/index.ts` imports `dynamicTool` and emits AI-SDK-shaped tools. `session/llm-native-tools.ts` invokes the AI SDK `tool.execute(...)` at the leaves (the native dispatcher still calls AI SDK tools).

opencode already has `Tool.Def` (`packages/opencode/src/tool/tool.ts`) which is the existing internal definition. It's the canonical shape for everything *except* the AI SDK adapter.

New flow:

- `resolveTools` returns `Record<string, Tool.Def>`. No AI SDK imports.
- `mcp/index.ts` emits `Tool.Def` directly. (`dynamicTool` only needed by the AI SDK adapter.)
- `session/backends/ai-sdk.ts` (Phase 4) converts `Tool.Def → AITool` lazily before calling `streamText`.
- `session/backends/native.ts` already speaks `Tool.Def` — no conversion needed.

The `Tool.Def → AITool` conversion is small: `tool({ description, parameters: jsonSchema(toolDef.inputSchema), execute: toolDef.execute })`. It's the only place `tool()` and `jsonSchema()` get imported.

#### 2c — `LLMUsage` and `ProviderMetadata`-the-opencode-type

Today: `session/session.ts` imports `LanguageModelUsage` and `ProviderMetadata` from `ai`. `getUsage(input)` reads `input.usage.inputTokens`, `outputTokens`, `inputTokenDetails.cacheReadTokens`, etc., and reads provider-specific fields from `metadata["anthropic"]["cacheCreationInputTokens"]`.

The `LLMUsage` shape in `@opencode-ai/llm` (`packages/llm/src/schema/events.ts`) already covers the cases (inputTokens, outputTokens, reasoningTokens, cacheReadInputTokens, cacheWriteInputTokens, totalTokens, native).

New flow:

```ts
// packages/opencode/src/session/session.ts
import { type Usage as LLMUsage, type ProviderMetadata } from "@opencode-ai/llm"

export const getUsage = (input: { model: Provider.Model; usage: LLMUsage; metadata?: ProviderMetadata }) => { ... }
```

`ProviderMetadata` from `@opencode-ai/llm/schema/ids.ts` is `Record<string, Record<string, unknown>>` — same shape, opencode-owned.

The AI SDK adapter (Phase 4) constructs `LLMUsage` from `LanguageModelUsage` once, just before yielding `step-finish`. Today's `getUsage` already does that math; we move it to the adapter.

#### 2d — `MessageV2.toLLMMessagesEffect` parallel to `toModelMessagesEffect`

Today: `session/message-v2.ts` is 1221 lines. The biggest function is `toModelMessagesEffect(input): Effect<ReadonlyArray<ModelMessage>>` which converts `WithParts[]` to AI SDK `ModelMessage[]`. It branches on `model.api.npm` for cache markers, file-URL handling, etc.

`session/llm-native.ts` does the same conversion to `LLM.Message[]` (the `@opencode-ai/llm` shape).

Phase 2d: keep both alive in parallel. Don't try to merge them yet. The AI SDK adapter (Phase 4) calls `toModelMessagesEffect`; the native adapter calls `toLLMMessagesEffect`.

The key win is that `MessageV2.WithParts` (opencode's stored shape) is the source of truth in both directions. Nothing above this layer cares which target shape is produced.

#### 2e — `LLM.generateObject(input, schema)` for structured output

Today: `agent/agent.ts` imports `generateObject` and `streamObject` from `ai` directly. Used to generate agent config (one-shot structured output, not part of `LLM.Service.stream`).

`@opencode-ai/llm` doesn't have `generateObject` yet. Strategy: keep AI SDK as the structured-output backend until we add it to `@opencode-ai/llm`, but isolate the call site behind an opencode-owned method:

```ts
// packages/opencode/src/session/llm.ts
LLM.Service.generateObject<T>(input: GenerateObjectInput, schema: Schema.Schema<T>): Effect<T, ProviderError>
```

`agent/agent.ts` calls `LLM.Service.generateObject(...)`. Inside, the AI SDK `generateObject` call lives in `session/backends/ai-sdk.ts`. The native backend either delegates to AI SDK or implements it (Phase 5 decision).

Pulls the only AI SDK import out of `agent/agent.ts`.

#### Order within Phase 2

Roughly leaf-to-root so each step's tests are self-contained:

1. **2a (ProviderError)** — small, isolated, no downstream churn.
2. **2c (LLMUsage / ProviderMetadata)** — cosmetic types-only swap in session.ts.
3. **2b (Tool.Def canonical)** — moderate; `resolveTools` is the biggest call site.
4. **2d (toLLMMessagesEffect)** — additive; `toModelMessagesEffect` keeps working.
5. **2e (LLM.generateObject)** — last; adds a Service method, isolates the agent.ts call site.

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
