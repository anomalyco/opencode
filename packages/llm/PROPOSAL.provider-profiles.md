# Proposal: Provider Profiles

## Summary

OpenAI-compatible provider knowledge is currently split across provider data, model helpers, resolver wiring, public provider wrappers, and tests. This proposal introduces a provider profile module that owns the facts for each OpenAI-compatible provider in one place.

The goal is to make adding or changing an OpenAI-compatible provider a one-profile edit instead of a small hunt across modules.

## Current Shape

Provider defaults live here:

```ts
// src/provider/openai-compatible-profile.ts
export const profiles = {
  baseten: { provider: "baseten", baseURL: "https://inference.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
}
```

Model helpers live in another module:

```ts
// src/provider/openai-compatible-chat.ts
export const deepseek = (input) => familyModel(families.deepseek, input)
export const togetherai = (input) => familyModel(families.togetherai, input)
```

Resolver behavior is also derived in `openai-compatible-family.ts`:

```ts
const resolutions = Object.fromEntries(
  Object.values(families).map((family) => [
    family.provider,
    ProviderResolver.make(family.provider, "openai-compatible-chat", { baseURL: family.baseURL }),
  ]),
)
```

OpenRouter has a separate wrapper that repeats the same shape:

```ts
// src/provider/openrouter.ts
const baseURL = "https://openrouter.ai/api/v1"

export const resolver = ProviderResolver.fixed("openrouter", "openai-compatible-chat", {
  baseURL,
})

export const model = (id, options = {}) =>
  OpenAICompatible.model(id, {
    ...options,
    provider: "openrouter",
    baseURL: options.baseURL ?? baseURL,
  })
```

Each piece is small, but the provider concept is scattered.

## Problem

The OpenAI-compatible provider module is shallow. Its interface gives callers a few helpers, but its implementation does not own the full provider concept.

To answer "what does DeepSeek mean in this package?" a maintainer has to inspect multiple places:

- `openai-compatible-family.ts` for id and base URL.
- `openai-compatible-chat.ts` for model helper behavior and capabilities.
- `provider-resolver.test.ts` for bridge expectations.
- Provider-specific wrapper modules like `openrouter.ts` to see which providers are special-cased.
- Patch TODOs in `AGENTS.md` to know which providers may need custom options or cleanup.

This hurts locality. Adding Mistral, Groq, Perplexity, Cohere, or more OpenAI-compatible families will likely spread more provider facts across the same modules.

## Proposed Shape

Introduce provider profiles:

```ts
export interface OpenAICompatibleProfile {
  readonly provider: string
  readonly baseURL?: string
  readonly displayName?: string
  readonly capabilities?: LLM.CapabilitiesInput
  readonly resolver?: Partial<Omit<ProviderResolution, "provider" | "protocol">>
  readonly modelDefaults?: Partial<Omit<OpenAICompatibleChatModelInput, "id" | "provider">>
}
```

Then define profiles in one module:

```ts
export const profiles = {
  deepseek: {
    provider: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    capabilities: { tools: { calls: true, streamingInput: true } },
  },
  togetherai: {
    provider: "togetherai",
    baseURL: "https://api.together.xyz/v1",
  },
  openrouter: {
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
  },
} as const satisfies Record<string, OpenAICompatibleProfile>
```

The profile module owns the basic observations:

```ts
export const byProvider = Object.fromEntries(
  Object.values(profiles).map((profile) => [profile.provider, profile]),
)

export const resolve = (provider: string) => {
  const profile = byProvider[provider]
  return ProviderResolver.make(provider, "openai-compatible-chat", {
    baseURL: profile?.baseURL,
    capabilities: profile?.capabilities,
    ...profile?.resolver,
  })
}

export const model = (profile: OpenAICompatibleProfile, id: string, options = {}) =>
  OpenAICompatibleChat.model({
    ...profile.modelDefaults,
    ...options,
    id,
    provider: profile.provider,
    baseURL: options.baseURL ?? profile.baseURL,
  })
```

Provider wrappers become tiny aliases over profiles:

```ts
// src/provider/openrouter.ts
export const profile = OpenAICompatibleProfiles.profiles.openrouter
export const resolver = OpenAICompatibleProfiles.resolverFor(profile)
export const adapters = [OpenAICompatibleChat.adapter]
export const model = (id: string, options = {}) => OpenAICompatibleProfiles.model(profile, id, options)
export const chat = model
```

Family helpers become profile-derived:

```ts
export const deepseek = (id: string, options = {}) =>
  OpenAICompatibleProfiles.model(OpenAICompatibleProfiles.profiles.deepseek, id, options)
```

## Why This Is Deepening

The provider profile module would be a deeper module because a small interface hides a larger set of provider facts.

The interface is the profile table plus a few observations:

```ts
OpenAICompatibleProfiles.resolve(provider)
OpenAICompatibleProfiles.model(profile, id, options)
OpenAICompatibleProfiles.byProvider[provider]
```

The implementation hides base URL defaults, resolver construction, default capabilities, model helper construction, and future provider-specific option defaults.

The deletion test says this module would earn its keep. If deleted, the provider facts would spread back into resolver code, wrapper modules, model helpers, and tests.

## Benefits

Locality improves because one provider profile owns the provider's base URL, default capabilities, resolver behavior, and model defaults.

Leverage improves because adding a provider like Mistral or Groq starts as one profile entry. If it later needs a thin wrapper or dedicated patch, that decision is attached to the profile instead of being rediscovered across files.

Tests improve because provider behavior can be tested at the profile interface:

```ts
expect(OpenAICompatibleProfiles.resolve("deepseek")).toMatchObject({
  provider: "deepseek",
  protocol: "openai-compatible-chat",
  baseURL: "https://api.deepseek.com/v1",
})
```

The wrapper tests can shrink because they no longer need to prove the same base URL wiring repeatedly.

## What Not To Do Yet

Do not turn profiles into a full plugin system.

Do not add arbitrary route predicates or ranking.

Do not pre-design every future provider quirk.

Do not move non-OpenAI-compatible providers into this table.

The first version should only consolidate facts that already exist: provider id, base URL, resolver defaults, model defaults, and capabilities.

## Migration Plan

1. Rename or replace `openai-compatible-family.ts` with `openai-compatible-profile.ts`.
2. Move the existing `families` entries into `profiles` without changing behavior.
3. Add profile helpers for `resolve`, `resolverFor`, and `model`.
4. Update `openai-compatible-chat.ts` family helpers to use profiles.
5. Update `openrouter.ts` to use an OpenRouter profile.
6. Keep current public helper names such as `OpenAICompatibleChat.deepseek(...)` and `OpenRouter.model(...)`.
7. Update resolver tests to assert through the profile interface.

## Open Questions

Should OpenRouter live in the OpenAI-compatible profile table even though it has a first-class public provider wrapper?

Should profiles include patch defaults later, or should patches remain entirely separate until a provider has concrete behavior to trace?

Should Mistral/Groq/Perplexity/Cohere start as profiles, or should they wait until recorded cassettes show whether they need thin dedicated wrappers?

## Recommendation

Do this as a small consolidation before adding more OpenAI-compatible providers. The module is likely to pay for itself immediately because the next provider decisions already need a single place to record what each provider is: generic compatible, compatible with quirks, or deserving a thin wrapper.
