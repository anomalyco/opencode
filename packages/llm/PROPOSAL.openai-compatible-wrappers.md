# Proposal: OpenAI-Compatible Thin Wrappers

## Summary

Keep `OpenAICompatibleChat` as the shared implementation for providers that expose `/chat/completions`, but distinguish three levels of provider support:

| Level | Use When | Example |
| --- | --- | --- |
| Profile | Provider only needs `provider`, `baseURL`, and capabilities. | DeepSeek text/tool basics, TogetherAI, Cerebras, Fireworks. |
| Thin wrapper | Provider speaks OpenAI Chat shape but needs named options, patches, capability defaults, metadata extraction, or provider-defined tools. | Mistral, Groq, Perplexity. |
| Dedicated protocol | Request lowering or stream parsing stops being OpenAI Chat-compatible. | Not justified for these providers yet. |

The important rule: do not clone `OpenAIChat.protocol` for provider wrappers unless cassettes prove the wire format has diverged. A thin wrapper should reuse the shared protocol and adapter machinery, then add only provider policy.

## Current Shape

Today the generic adapter is already deep and reusable:

```ts
// src/provider/openai-compatible-chat.ts
export const adapter = Adapter.make({
  id: "openai-compatible-chat",
  protocol: OpenAIChat.protocol,
  protocolId: "openai-compatible-chat",
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})
```

Provider profiles are data:

```ts
// src/provider/openai-compatible-profile.ts
export const profiles = {
  baseten: { provider: "baseten", baseURL: "https://inference.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
}
```

Current direct call site:

```ts
const model = OpenAICompatibleChat.deepseek({
  id: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
})

const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] })
```

Current generic call site:

```ts
const model = OpenAICompatible.model("moonshot-v1-8k", {
  provider: "moonshot",
  baseURL: "https://api.moonshot.ai/v1",
  apiKey: process.env.MOONSHOT_API_KEY,
})

const llm = LLMClient.make({ adapters: OpenAICompatible.adapters })
```

Current OpenCode bridge shape:

```ts
OpenAICompatible.model("deepseek-chat", {
  provider: "deepseek",
  baseURL: OpenAICompatibleProfiles.profiles.deepseek.baseURL,
  apiKey,
})
// provider: "deepseek", protocol: "openai-compatible-chat"
```

Current default patches already contain provider-specific OpenAI-compatible policy:

```ts
ProviderPatch.scrubMistralToolIds
ProviderPatch.repairMistralToolResultUserSequence
ProviderPatch.addDeepSeekEmptyReasoning
ProviderPatch.moveOpenAICompatibleReasoningToNative
ProviderPatch.sanitizeMoonshotToolSchema
ProviderPatch.addOpenAICompatibleModalities
```

That is the right direction, but Mistral/Groq/Perplexity need a named home if they grow more than one or two patch entries.

## AI SDK Comparison

AI SDK has a generic `@ai-sdk/openai-compatible` provider, but it does not implement Mistral, Groq, Perplexity, or xAI chat by simply configuring that generic provider.

| Provider | AI SDK Shape | Why It Is Not Generic Only |
| --- | --- | --- |
| Mistral | Dedicated `MistralChatLanguageModel`. | `safe_prompt`, document limits, structured-output defaults, strict JSON schema, and special tool-choice mapping. |
| Groq | Dedicated `GroqChatLanguageModel`. | `reasoning_format`, `reasoning_effort`, `service_tier`, `parallel_tool_calls`, and provider-defined `browser_search`. |
| Perplexity | Dedicated `PerplexityLanguageModel`. | Citations, images, citation token usage, search query usage, provider option passthrough. |
| xAI | Dedicated `XaiChatLanguageModel`. | Search parameters, reasoning effort, xAI-specific tools/options; AI SDK only reuses OpenAI-compatible for xAI image generation. |

The lesson is not “copy AI SDK and create full dedicated adapters.” The lesson is that these providers have real named policy. In this package, named policy should start as thin wrappers over `OpenAICompatibleChat`.

## Proposed Shape

A thin wrapper is a provider-local module that reuses the common OpenAI-compatible adapter and protocol, then exports provider-specific model helpers, adapters, and patches.

Example Mistral wrapper:

```ts
// src/provider/mistral.ts
export const profile = {
  provider: "mistral",
  baseURL: "https://api.mistral.ai/v1",
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
} satisfies OpenAICompatibleProfile

export const model = (input: ProviderFamilyModelInput) =>
  OpenAICompatibleChat.profileModel(profile, input)

export const chat = model

export const patches = [
  ProviderPatch.scrubMistralToolIds,
  ProviderPatch.repairMistralToolResultUserSequence,
  mistralToolChoicePatch,
  mistralStructuredOutputPatch,
]

export const adapters = [
  OpenAICompatibleChat.adapter.withPatches([mistralIncludeUsage]),
]

export * as Mistral from "./mistral"
```

The direct call site becomes named and discoverable:

```ts
const model = Mistral.chat({
  id: "mistral-large-latest",
  apiKey: process.env.MISTRAL_API_KEY,
})

const llm = LLMClient.make({
  adapters: Mistral.adapters,
  patches: ProviderPatch.defaults,
})
```

The existing generic call site still works for unwrapped providers:

```ts
const model = OpenAICompatible.model("some-model", {
  provider: "some-provider",
  baseURL: "https://api.some-provider.test/v1",
  apiKey,
})
```

OpenCode bridge call sites become clearer:

```ts
Mistral.chat({
  id: "mistral-large-latest",
  apiKey,
})
// provider: "mistral", protocol: "openai-compatible-chat"
// baseURL defaults to "https://api.mistral.ai/v1"
```

## Provider Recommendations

| Provider | Today | Proposed Next Step | Reason |
| --- | --- | --- | --- |
| DeepSeek | Profile plus default reasoning patches. | Keep profile for now. | Current cassettes cover basic text; policy is still small and shared. |
| TogetherAI | Profile. | Keep profile. | No named provider policy yet beyond base URL. |
| Mistral | No profile helper yet, but default Mistral patches exist. | Add thin wrapper. | Policy already exists and AI SDK has enough Mistral-specific behavior to justify a named home. |
| Groq | No profile helper yet. | Start as profile or thin wrapper with only base URL; promote when reasoning/browser-search lands. | Basic OpenAI-compatible flow should work, but provider-defined tools and reasoning options need a wrapper. |
| Perplexity | No profile helper yet. | Add thin wrapper if citations/sources matter; otherwise start as profile for text only. | The value of Perplexity is source/search metadata, not just text. |
| xAI/Grok | Model helper currently points to `openai-responses`. | Keep separate from generic profiles. | xAI search/reasoning behavior is provider policy, and AI SDK treats chat as dedicated. |

## Why This Is Better Than Adding More Profiles Only

Profiles are excellent for base URL defaults. They become muddy when they need provider policy:

```ts
profiles.mistral = {
  provider: "mistral",
  baseURL: "https://api.mistral.ai/v1",
  patches: [...],          // not a profile anymore
  options: {...},          // starts becoming a provider module
  metadata: extract...,    // definitely not profile data
}
```

Keeping profiles as data preserves their simplicity. Thin wrappers are where behavior belongs.

## Why This Is Better Than Dedicated Protocols Now

A dedicated protocol would duplicate the OpenAI Chat payload schema, message lowering, SSE framing, tool-call parsing, usage mapping, and finish mapping before we know those providers require it.

Thin wrappers keep one source of truth:

```ts
OpenAIChat.protocol
  -> OpenAICompatibleChat.adapter
  -> Mistral/Groq/Perplexity wrapper policy
```

If a recorded cassette later shows a provider emits incompatible stream chunks, that is the moment to split the protocol.

## Implementation Plan

1. Add `src/provider/mistral.ts` as the first thin wrapper because Mistral policy already exists in `ProviderPatch.defaults`.
2. Add Mistral to exports and model-helper bridge tests.
3. Add a recorded Mistral text cassette and tool cassette.
4. Only then decide whether Mistral needs payload patches for tool-choice or structured-output behavior.
5. Add Groq as a profile first, unless we immediately implement reasoning/browser-search options.
6. Add Perplexity as a thin wrapper when source/citation events or metadata are modeled.

## Open Questions

- Should provider wrapper modules export `adapters` or rely on callers using `OpenAICompatible.adapters`?
- Should wrapper-specific patches be included in `ProviderPatch.defaults`, or should wrappers export a `patches` list for explicit opt-in?
- Do Perplexity citations become common `source` events/content, provider-native metadata, or both?
- Should xAI continue routing to `openai-responses`, or should we add an xAI Chat wrapper when we add xAI cassettes?
