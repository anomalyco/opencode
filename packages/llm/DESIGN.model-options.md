# Model Options Design

## Status

Recommendation: copy the good part of AI SDK and Effect Smol, but keep our raw HTTP escape hatch explicit.

Use three channels:

- `generation`: standard model-call controls shared across providers.
- `providerOptions`: namespaced provider-native options, typed by provider facades.
- `http`: serializable raw request overlays for body, headers, and query.

Do not make reasoning generic for now. Provider reasoning behavior is too different across OpenAI, Anthropic, Gemini, and OpenRouter.

## Problem

The old transform pipeline mixed too many concerns:

- Standard sampling/output controls, such as temperature and max tokens.
- Provider-native behavior, such as Anthropic thinking or OpenAI reasoning effort.
- Provider routing, such as OpenRouter provider order or fallback models.
- HTTP details, such as headers, query params, and raw body fields.
- Arbitrary function hooks that cannot be represented by `models.dev`.

That made the API hard to explain and impossible to serialize cleanly. We still need the useful parts: `models.dev` should describe provider endpoints and defaults, OpenCode should pass per-call overrides, and low-level users should have a raw escape hatch without overriding `fetch`.

## Goals

- Keep normal calls boring: provider creates a model, `LLM.generate` / `LLM.stream` runs it.
- Put common generation controls in one provider-neutral place.
- Put provider-specific behavior in provider-specific namespaces.
- Allow the same option shape on model defaults and call overrides.
- Keep raw HTTP patches serializable.
- Avoid reintroducing arbitrary function transforms as the normal extension model.

## Non-Goals

- Make every provider option portable.
- Pretend reasoning has one cross-provider API.
- Support arbitrary user code in `models.dev` data.
- Encode stream framing, chunk decoding, or parser behavior as data patches.

## Recommended Shape

```ts
type ModelCallOptions = {
  readonly generation?: GenerationOptions
  readonly providerOptions?: ProviderOptions
  readonly http?: HttpOptions
}

type GenerationOptions = {
  readonly maxTokens?: number
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly seed?: number
  readonly stop?: readonly string[]
}

type ProviderOptions = {
  readonly openai?: OpenAIOptions
  readonly anthropic?: AnthropicOptions
  readonly gemini?: GeminiOptions
  readonly openrouter?: OpenRouterOptions
  readonly gateway?: GatewayOptions
  readonly [provider: string]: Record<string, unknown> | undefined
}

type HttpOptions = {
  readonly body?: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly query?: Record<string, string>
}
```

Example call:

```ts
LLM.stream({
  model,
  prompt: "hi",
  generation: {
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    frequencyPenalty: 0.2,
    presencePenalty: 0.1,
    seed: 123,
    stop: ["</done>"],
  },
  providerOptions: {
    anthropic: {
      thinking: { type: "enabled", budgetTokens: 4096 },
    },
  },
  http: {
    body: {
      raw_provider_field: true,
    },
  },
})
```

## Model Defaults And Call Overrides

The same shape should be accepted in both places.

Model-level options are defaults:

```ts
const model = Anthropic.model("claude-sonnet-4-5", {
  generation: {
    maxTokens: 8192,
  },
  providerOptions: {
    anthropic: {
      thinking: { type: "enabled", budgetTokens: 4096 },
    },
  },
})
```

Call-level options are overrides:

```ts
LLM.stream({
  model,
  prompt: "answer quickly",
  generation: {
    maxTokens: 1024,
  },
  providerOptions: {
    anthropic: {
      thinking: { type: "disabled" },
    },
  },
})
```

Merge order:

1. Protocol-generated payload and route-generated transport defaults.
2. Model/provider defaults.
3. Variant-resolved defaults.
4. Call-level overrides.
5. `http` overlays into final outgoing request shape.

Later entries win. `generation` is shallow-merged. `providerOptions` is deep-merged by provider namespace, with arrays replaced. `http.body` is deep-merged, while `http.headers` and `http.query` are shallow-merged.

## Variants

Variants should not be a runtime `LLM.stream` option. A variant is a model-description preset.

By the time a request reaches `LLM.stream`, the selected variant should already be merged into the model defaults:

```ts
variants: {
  thinking: {
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 4096 },
      },
    },
  },
  cheap: {
    providerOptions: {
      openrouter: {
        provider: { sort: "price" },
      },
    },
  },
}
```

## Reasoning

Reasoning should be provider-native for now.

Do this:

```ts
providerOptions: {
  openai: {
    reasoningEffort: "high",
    reasoningSummary: "auto",
  },
}
```

```ts
providerOptions: {
  anthropic: {
    thinking: { type: "enabled", budgetTokens: 4096 },
  },
}
```

```ts
providerOptions: {
  gemini: {
    thinkingConfig: {
      thinkingBudget: 4096,
      includeThoughts: true,
    },
  },
}
```

```ts
providerOptions: {
  openrouter: {
    reasoning: {
      effort: "high",
    },
  },
}
```

Do not start with this:

```ts
policy: {
  reasoning: { effort: "high" },
}
```

The generic shape is attractive, but it is easy to silently do the wrong thing. Anthropic thinking requires budget interactions and disables or rewrites other settings. OpenAI reasoning is model-family-specific. Gemini exposes thinking config differently. OpenRouter normalizes some reasoning behavior but also has OpenRouter-specific fields such as `max_tokens`, `enabled`, and `exclude` in its own API ecosystem.

If a truly safe shared reasoning intent emerges later, add it then. Until then, keep exact behavior in `providerOptions.<provider>`.

## HTTP Overlays

`http` is the replacement for request transform hooks.

```ts
http: {
  body: {
    newly_released_option: true,
  },
  headers: {
    "X-OpenRouter-Title": "opencode",
  },
  query: {
    "api-version": "2026-05-01",
  },
}
```

This is intentionally less powerful than arbitrary transforms. It can patch outgoing HTTP shape, but it cannot change stream framing, chunk parsing, tool runtime behavior, or auth signing code.

If a raw field becomes common and stable, promote it from `http.body` into typed `providerOptions`.

## What Happened To `policy`?

Do not keep `policy` as a separate public bucket for now. The useful ideas from `policy` still exist, but they should move to clearer homes.

Usage is the best example. The library should always collect usage when the provider emits it. For providers that require an opt-in to include usage in streaming chunks, the route should opt in by default when it is safe and normal for that protocol.

This matches other libraries:

- AI SDK's OpenAI Chat streaming always sends `stream_options: { include_usage: true }`.
- Effect Smol's OpenRouter and OpenAI-compatible streaming clients always send `stream_options: { include_usage: true }`.

So this should not be a user-facing generic option:

```ts
policy: {
  usage: { include: true },
}
```

Instead:

- Common usage collection is route/protocol behavior.
- Provider-specific usage accounting stays in `providerOptions`, e.g. OpenRouter `usage` fields if needed.
- Raw experimental usage fields stay in `http.body` until promoted.

Other former `policy` concepts map the same way:

| Old policy idea         | New home                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Include streamed usage  | Route/protocol default when safe; provider option only if genuinely configurable                                      |
| Include cost/accounting | `providerOptions.<provider>` because cost accounting is provider-specific                                             |
| Retention / store       | `providerOptions.openai.store`, `providerOptions.openrouter.provider.dataCollection`, `providerOptions.gateway`, etc. |
| Prompt cache            | Message/content-part `providerOptions` for cache markers, or provider-specific call options                           |
| Text verbosity          | `generation` only if we decide it is common; otherwise `providerOptions.openai.textVerbosity`                         |
| Reasoning               | `providerOptions.<provider>`, not generic policy                                                                      |

If a concept later proves both portable and semantically safe, add a typed standard field. Until then, prefer `generation` for shared generation controls and `providerOptions` for exact provider behavior.

## Comparison: AI SDK

Source checked: `/Users/kit/code/open-source/ai`.

AI SDK uses call-level `providerOptions`, namespaced by provider:

```ts
providerOptions: {
  openai: {
    reasoningEffort: "low",
  },
  anthropic: {
    thinking: { type: "enabled", budgetTokens: 12000 },
  },
}
```

Important details:

- Core type is `SharedV3ProviderOptions = Record<string, Record<string, JSONValue>>`.
- `LanguageModelV3CallOptions` includes `providerOptions` and `headers`.
- Prompt messages and content parts also have `providerOptions`.
- Providers call `parseProviderOptions({ provider, providerOptions, schema })` and validate only their namespace.
- OpenAI options include `reasoningEffort`, `reasoningSummary`, `serviceTier`, `store`, `metadata`, `promptCacheKey`, `textVerbosity`, and other OpenAI-native fields.
- Anthropic options include `thinking`, `sendReasoning`, `disableParallelToolUse`, and `cacheControl`.
- Model defaults are possible with model wrapping / `defaultSettingsMiddleware`; defaults and call settings are merged, with call settings winning.

Takeaway: copy the namespaced `providerOptions` idea. Do not copy every AI SDK naming choice blindly, but matching this shape lowers migration friction for OpenCode.

References:

- `/Users/kit/code/open-source/ai/packages/provider/src/shared/v3/shared-v3-provider-options.ts`
- `/Users/kit/code/open-source/ai/packages/provider/src/language-model/v3/language-model-v3-call-options.ts`
- `/Users/kit/code/open-source/ai/packages/provider/src/language-model/v3/language-model-v3-prompt.ts`
- `/Users/kit/code/open-source/ai/packages/provider-utils/src/parse-provider-options.ts`
- `/Users/kit/code/open-source/ai/packages/ai/src/middleware/default-settings-middleware.ts`
- `/Users/kit/code/open-source/ai/packages/openai/src/chat/openai-chat-options.ts`
- `/Users/kit/code/open-source/ai/packages/anthropic/src/anthropic-messages-options.ts`

## Comparison: OpenRouter SDKs

Source checked:

- `/Users/kit/code/open-source/openrouter-typescript-sdk`
- OpenRouter docs and `@openrouter/ai-sdk-provider` docs/source snippets.

OpenRouter now has multiple surfaces:

- Official client SDKs: `@openrouter/sdk`, Python `openrouter`, and Go `github.com/OpenRouterTeam/go-sdk`.
- Agent SDK: `@openrouter/agent` for `callModel`, tools, and multi-turn orchestration.
- AI SDK provider: `@openrouter/ai-sdk-provider`.

The official TypeScript SDK is generated from OpenRouter's OpenAPI spec and mirrors the REST API. As of local `@openrouter/sdk` version `0.12.28`, the generated models show:

- `ChatRequest.provider?: ProviderPreferences` with `allowFallbacks`, `dataCollection`, `enforceDistillableText`, `ignore`, `maxPrice`, `only`, `order`, `preferredMaxLatency`, `preferredMinThroughput`, `quantizations`, `requireParameters`, `sort`, and `zdr`.
- `ChatRequest.models?: string[]` for fallback model lists.
- `ChatRequest.debug.echoUpstreamBody`, lowered to `debug.echo_upstream_body`.
- `ChatRequest.plugins` for built-in OpenRouter plugins.
- `ChatRequest.reasoning` currently has `effort` and `summary`.
- `ResponsesRequest.reasoning` has `effort`, `summary`, `enabled`, and `maxTokens`, lowered to `max_tokens`.
- `ChatRequest.streamOptions.includeUsage` exists but is marked deprecated in the SDK because full usage details are always included by OpenRouter.
- `transforms` is not present in the current generated TypeScript client request model.

The OpenRouter AI SDK provider exposes `providerOptions.openrouter` and `extraBody`. Its `providerOptions.openrouter` is merged directly into the OpenRouter request body; `extraBody` can be set at provider/model construction time.

Takeaway: OpenRouter-specific routing, reasoning, debug, plugins, and fallback models belong in `providerOptions.openrouter`. Unknown or legacy fields belong in `http.body` until typed.

## Comparison: Effect Smol AI

Source checked: `/Users/kit/code/open-source/effect-smol`.

Effect Smol makes a different split:

- `LanguageModel.generateText` / `streamText` call options stay minimal: prompt, toolkit, tool choice, concurrency, and tool-call resolution behavior.
- Provider request fields such as `temperature`, `top_p`, `max_tokens`, OpenAI `reasoning`, Anthropic `output_config`, and OpenRouter routing fields live in provider-specific `Config` services and model/layer config.
- Providers expose `withConfigOverride(...)` to apply per-request provider config overrides.
- Prompt messages and content parts have namespaced provider-specific `options`, typed through module augmentation, e.g. `options.openai`, `options.anthropic`, and `options.openrouter`.
- Response parts similarly carry namespaced provider metadata.

Concrete examples from source:

- OpenAI `Config` is a partial of OpenAI Responses request fields, minus fields owned by common prompt/tool lowering.
- Anthropic `Config` is a partial of Anthropic Messages params, with `output_config.effort`, `disableParallelToolCalls`, and `strictJsonSchema` additions.
- OpenRouter `Config` is a partial of OpenRouter chat params, minus fields owned by common prompt/tool lowering.
- `withConfigOverride({ temperature: 0.9 })` overrides model config `{ temperature: 0.5 }` in tests.

Takeaway: Effect Smol validates the model-default plus per-request override pattern and the namespaced prompt/message/part option pattern. It does not argue for generic reasoning; it keeps provider request behavior provider-native.

References:

- `/Users/kit/code/open-source/effect-smol/packages/effect/src/unstable/ai/LanguageModel.ts`
- `/Users/kit/code/open-source/effect-smol/packages/effect/src/unstable/ai/Prompt.ts`
- `/Users/kit/code/open-source/effect-smol/packages/ai/openai/src/OpenAiLanguageModel.ts`
- `/Users/kit/code/open-source/effect-smol/packages/ai/anthropic/src/AnthropicLanguageModel.ts`
- `/Users/kit/code/open-source/effect-smol/packages/ai/openrouter/src/OpenRouterLanguageModel.ts`
- `/Users/kit/code/open-source/effect-smol/packages/ai/openai/test/OpenAiLanguageModel.test.ts`

## Ranked Recommendations

1. **Adopt `generation` + `providerOptions` + `http`.** This is the clearest shape for our current library. It preserves common call controls, keeps provider behavior exact, and gives a serializable escape hatch.

2. **Accept the same option shape on models and calls.** Model options are defaults. Call options override. Variants resolve into the same shape before `LLM.stream` / `LLM.generate`.

3. **Keep reasoning in `providerOptions` for now.** Use `providerOptions.openai.reasoningEffort`, `providerOptions.anthropic.thinking`, `providerOptions.gemini.thinkingConfig`, and `providerOptions.openrouter.reasoning`. Do not add generic `policy.reasoning` yet.

4. **Add typed provider option schemas at provider facades.** Core can store `providerOptions` as a serializable record, but provider helpers should expose typed inputs and validate their namespace.

5. **Add message/content-part provider options after call-level options.** AI SDK and Effect Smol both need provider-specific prompt annotations for cache control, file citations, image detail, reasoning metadata, and similar features. We should eventually support that shape too.

6. **Keep `http` overlays last-resort and serializable.** Do not restore function transforms as the main extension point. Promote stable raw fields into typed `providerOptions` over time.

7. **Do not use `native` for provider request options.** Reserve `native` only for genuinely runtime-private implementation details if we keep it at all. Public provider request behavior should be `providerOptions`.

## Tracked Follow-Ups

These are intentionally tracked separately from the initial call-option refactor:

- **Message/content-part `providerOptions`.** Needed for provider-native prompt annotations such as Anthropic cache markers, OpenAI/Gemini image detail, file citation controls, and reasoning metadata.
- **Provider metadata on response parts/events.** Needed for reasoning signatures, citations, source documents, provider ids, and native usage/accounting details without adding provider-specific fields to common events.
- **Provider-specific schema transformers.** Structured output and tool schemas need provider-owned JSON Schema rewrites, especially for Gemini-style schema dialect differences.
- **Provider config defaults/overrides.** Model defaults plus call overrides cover most of Effect Smol's `withConfigOverride(...)` pattern; keep this in mind if provider-layer config grows beyond model refs.
- **Tool choice subsets.** Add a common way to say “one of these tools” in addition to `auto`, `none`, `required`, and one specific tool.

## Current Code Delta

Implemented in the current code direction:

- `generation` exists on model defaults and requests, including `maxTokens`, `temperature`, `topP`, `topK`, `frequencyPenalty`, `presencePenalty`, `seed`, and `stop`.
- `providerOptions` exists on model defaults and requests; call-level provider namespaces override model defaults.
- `http` exists on model defaults and requests with serializable `body`, `headers`, and `query` overlays.
- Generic `policy`, request-level `reasoning`, and request-level `cache` were removed from the public LLM request/model shape.
- `native` remains only on `ModelRef`, `Message`, and `ToolDefinition` for runtime-private or round-trip implementation data.

Recommended next code changes:

1. Add typed provider-option schemas per provider facade instead of accepting only unvalidated records.
2. Add message/content-part `providerOptions` for prompt annotations and cache markers.
3. Add provider metadata on response events/parts for citations, reasoning signatures, and native ids.
4. Add provider-owned JSON Schema transformers for structured output and tool schema dialects.
5. Add tool-choice subsets.

## Rule Of Thumb

- If it is sampling/output control that most providers support, put it in `generation`.
- If it is provider behavior, put it in `providerOptions.<provider>`.
- If it is a raw outgoing HTTP patch, put it in `http.body`, `http.headers`, or `http.query`.
- If it applies to a message or content part, use message/part provider options rather than call-level options.
- If it changes stream framing or chunk parsing, it belongs in route/protocol code.
- If it requires arbitrary logic, generate code or write a provider wrapper; do not put it in serializable config.

## Open Questions

- Should the public raw overlay be named `http` or `request`? `http` is more explicit and avoids confusing it with `LLMRequest`; `request` matches OpenAI-style terminology.
- Should `providerOptions` allow arbitrary provider keys in public types, or only known provider namespaces plus an escape hatch?
- Should `http.body` allow deletion/null semantics, or only add/replace semantics?
- Should auth headers always win over `http.headers`, or should callers be allowed to override auth intentionally?
- How much compatibility should we keep for current `policy`, `reasoning`, `cache`, and `native` WIP fields while migrating?
