# Native Provider Plugin Design

## Status

Proposal: make the existing provider module shape explicit as `Provider.Definition`, use it internally for built-ins, and let OpenCode dynamically import third-party packages that export the same definition.

This should not introduce a second provider abstraction. `Adapter.model(...)` remains the lower-level primitive for turning one adapter route into a model factory. `Provider.Definition` is the uniform provider facade: an ID, a default `model(...)` factory, and optional named APIs such as `chat` or `responses`.

Do not reuse the existing `models.dev` `npm` field for native routing. That field currently means "AI SDK provider package" and is part of OpenCode's existing fallback path. Add a separate native metadata field instead.

## Problem

OpenCode's current provider loading path can import arbitrary AI SDK provider packages because the AI SDK already defines the package contract:

- Metadata names an npm package like `@ai-sdk/openai`.
- OpenCode imports that package.
- OpenCode finds a `create*` export.
- OpenCode calls the factory with `{ name, apiKey, baseURL, headers, ...options }`.
- The returned object implements the AI SDK model interface.

The native `@opencode-ai/llm` path has no equivalent package contract yet. A native model cannot be resolved from an npm package name alone because it must know:

- Which public model factory to call.
- Which model API, if any, should be selected explicitly.
- Which endpoint and base URL rules apply.
- Which auth renderer applies.
- Which provider option namespace and option lowering apply.
- Which model capabilities and limits OpenCode should attach.
- Which provider-specific behavior belongs in code rather than `models.dev` data.

The current OpenCode bridge therefore uses a local table from AI SDK package identifiers to built-in native provider helpers. That is good enough for migration, but not enough for third-party native providers.

## Goals

- Let third parties publish native OpenCode LLM providers as npm packages.
- Make provider packages explicit and type-checkable instead of guessing export names.
- Keep built-in providers and external packages using one self-similar provider interface.
- Reuse `Adapter.model(...)` as the implementation primitive instead of creating a competing model factory abstraction.
- Keep `models.dev` metadata declarative and serializable.
- Keep provider-specific signing, parsing, URL construction, and option lowering in code.
- Preserve the existing AI SDK provider path as a fallback while native support rolls out.
- Support OpenAI-compatible provider families without requiring a new package for every base URL.

## Non-Goals

- Do not dynamically import arbitrary packages and guess a `create*` export for native providers.
- Do not encode protocol parsers, auth signing logic, stream framing, or arbitrary functions in `models.dev`.
- Do not make every provider option portable across providers.
- Do not require immediate extraction of every built-in provider into its own package.
- Do not remove the AI SDK path as part of this design.

## Recommended Shape

Add a first-class provider definition contract to `@opencode-ai/llm`. A native provider package is simply an npm package that exports a `Provider.Definition`.

```ts
export interface Definition<Factory extends AnyModelFactory = ModelFactory> {
  readonly id: ProviderID
  readonly model: Factory
  readonly apis?: Record<string, AnyModelFactory>
}

export type ModelFactory<Options extends ModelOptions = ModelOptions> = (
  id: string | ModelID,
  options?: Options,
) => ModelRef

export type ModelOptions = Omit<AdapterModelInput, "id">

type AnyModelFactory = (...args: never[]) => ModelRef

export const make = <DefinitionType extends Definition>(definition: DefinitionType) => definition
```

The contract is intentionally close to what provider modules already export today:

- `id`: native provider ID.
- `model`: default model factory.
- `apis`: optional named factories for providers with multiple first-class APIs.

Provider IDs and model IDs should use the existing branded types from `src/schema.ts`: `ProviderID` and `ModelID`. Public factories may accept `string | ModelID` for ergonomics, but they normalize to branded IDs at the boundary before constructing a `ModelRef`.

The model factory shape is fixed on purpose: `(id, options) => ModelRef`. Provider-specific differences belong in the options type, not in positional arguments. `Provider.make(...)` preserves each provider's actual option type, including whether options are optional or required.

`Provider.Definition.model(...)` should usually be implemented with `Adapter.model(...)` or existing protocol helpers. The layers are:

```text
Protocol + Endpoint + Auth + Framing -> Adapter
Adapter.model(...)                   -> route-specific model factory
Provider.Definition                  -> uniform provider facade / package contract
```

Adapters are deliberately not part of the provider package contract. They are implementation details owned by the model factories. `Adapter.make(...)` registers runnable adapters when a provider module is loaded, and `Adapter.model(...)` also ensures the selected adapter is registered when a model factory is called. Keeping adapter lists out of `Provider.Definition` avoids a second source of truth.

Provider packages export a provider definition that is both the dynamic-loading contract and the direct user-facing entry point:

```ts
import { Provider } from "@opencode-ai/llm/provider"
import * as OpenRouter from "./openrouter"

export const provider = Provider.make({
  id: ProviderID.make("openrouter"),
  model: OpenRouter.model,
})

export const model = provider.model
export default provider
```

Direct users can consume the definition instead of a separate helper namespace:

```ts
import OpenRouter from "@opencode-ai/llm-provider-openrouter"

const model = OpenRouter.model("openai/gpt-4o-mini", { apiKey })
```

Named exports are convenience aliases for users who prefer `import { model } from ...`; they should point back to the provider definition rather than duplicating implementation.

Providers with multiple public model APIs expose those factories without making OpenCode know provider-specific function names:

```ts
export const provider = Provider.make({
  id: ProviderID.make("openai"),
  model: OpenAI.model,
  apis: {
    responses: OpenAI.responses,
    chat: OpenAI.chat,
  },
})

export const model = provider.model
export const responses = provider.apis.responses
export const chat = provider.apis.chat
export default provider
```

Direct users can still write `OpenAI.responses(...)` or `OpenAI.chat(...)`, but those helpers should be aliases of the provider definition. The provider definition is the source of truth; dynamic loaders and direct users consume the same object.

This mirrors the AI SDK OpenAI provider shape: `openai(modelId)` is the default factory, while `openai.responses(modelId)`, `openai.chat(modelId)`, and `openai.completion(modelId)` explicitly select an OpenAI API.

## OpenCode Resolve Input

OpenCode still needs to translate `models.dev` and config into provider model options. That translation should live in the OpenCode bridge, not in a separate plugin-only API.

```ts
type NativeProviderModelInput = Provider.ModelOptions & {
  readonly apiID: string
  readonly apiURL?: string
}
```

Bridge rule:

```ts
const factory = native.api ? provider.apis?.[native.api] : provider.model
return factory?.(input.apiID, {
  ...input.options,
  apiKey: input.apiKey,
  baseURL: input.apiURL,
  headers: input.headers,
  capabilities: input.capabilities,
  limits: input.limits,
  providerOptions: input.providerOptions,
})
```

That keeps provider modules self-similar. Built-ins, external packages, and OpenCode all call the same `model(id, options)` shape.

## Ideal Usage API

The public use site should feel like AI SDK's provider objects, but return native `ModelRef` values.

Default provider API:

```ts
import { LLM } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"

const model = OpenAI.model("gpt-5", {
  apiKey,
  providerOptions: {
    openai: { store: false },
  },
})

const request = LLM.request({
  model,
  prompt: "Explain this in one paragraph.",
})
```

Explicit provider model API, for providers with more than one first-class API:

```ts
const responsesModel = OpenAI.apis.responses("gpt-5", { apiKey })
const chatModel = OpenAI.apis.chat("gpt-4o", { apiKey })
```

Named aliases can exist for ergonomics, but they should be aliases of the provider definition:

```ts
const responsesModel = OpenAI.responses("gpt-5", { apiKey })
const chatModel = OpenAI.chat("gpt-4o", { apiKey })
```

Third-party providers should look the same:

```ts
import Acme from "@acme/opencode-llm-provider"

const model = Acme.model("acme-large", {
  apiKey,
  baseURL: "https://llm.acme.test/v1",
})
```

OpenCode's dynamic path should consume the same object the user sees:

```ts
const provider = await loadProviderDefinition(native.npm)
const create = native.api ? provider.apis?.[native.api] : provider.model
const model = create?.(apiID, options)
```

The important invariant: there is no plugin-only shape. The default export from a provider package is the user-facing provider object and the dynamic-loading contract.

## Metadata

Keep AI SDK metadata and native metadata separate.

```json
{
  "npm": "@openrouter/ai-sdk-provider",
  "opencode": {
    "provider": "openrouter",
    "npm": "@opencode-ai/llm-provider-openrouter"
  }
}
```

For built-in providers, `opencode.npm` can be omitted:

```json
{
  "npm": "@ai-sdk/openai",
  "opencode": {
    "provider": "openai"
  }
}
```

For OpenAI-compatible providers that only need a base URL/profile, use a built-in generic native provider:

```json
{
  "npm": "@ai-sdk/openai-compatible",
  "api": "https://api.example.com/v1",
  "opencode": {
    "provider": "openai-compatible"
  }
}
```

Model-level overrides may refine the provider model API without replacing the whole provider:

```json
{
  "provider": {
    "npm": "@ai-sdk/azure",
    "opencode": {
      "provider": "azure",
      "api": "chat"
    }
  }
}
```

Recommended metadata fields:

```ts
type ModelsDevProviderNative = {
  readonly provider: string
  readonly npm?: string
  readonly api?: string
  readonly profile?: string
}
```

`provider` selects a native provider definition. `npm` optionally names an external native provider package. `api` selects a named provider API such as `chat` or `responses`. `profile` is a declarative hint that built-in generic providers may use; it is not executable code.

## Resolution Flow

OpenCode's native bridge should resolve a model in this order:

1. Read `model.provider.opencode` if present, otherwise `provider.opencode`.
2. If `opencode.npm` is present, dynamically import that package and validate its default export as a `Provider.Definition`.
3. Otherwise find a built-in plugin by `opencode.provider`.
4. If no native metadata exists, fall back to the temporary compatibility map from AI SDK package names to built-in plugins.
5. Translate OpenCode's `Provider.Info` and `Provider.Model` into provider model options.
6. Select `provider.apis[opencode.api]` when an API is present, otherwise use `provider.model`.
7. Call the selected model factory with `apiID` and model options to get a `ModelRef`.
8. If no provider or model API exists, treat the model as unsupported by the native path and fall back to the AI SDK path.

The compatibility map should be treated as migration glue, not the long-term source of truth.

## Built-In Providers

Built-ins should use the same provider definition contract as external packages.

```ts
export const openai = Provider.make({
  id: ProviderID.make("openai"),
  model: OpenAI.model,
  apis: {
    responses: OpenAI.responses,
    chat: OpenAI.chat,
  },
})
```

`@opencode-ai/llm/providers` can continue exporting helper namespaces for direct users. A new registry module can export plugins:

```ts
export const builtins = {
  openai,
  anthropic,
  google,
  azure,
  openrouter,
  "openai-compatible": openAICompatible,
}
```

This keeps OpenCode's bridge generic while preserving the ergonomic direct API:

```ts
const model = OpenAI.model("gpt-5", { apiKey })
```

## Package Boundaries

Keep provider implementations in-tree until the plugin API stabilizes. Extract later where package boundaries provide real value.

Good extraction candidates:

- `@opencode-ai/llm-provider-bedrock`: AWS SigV4, event-stream framing, region/profile handling.
- `@opencode-ai/llm-provider-vertex`: Google auth, project/location routing, Gemini and Anthropic variants.
- `@opencode-ai/llm-provider-openrouter`: OpenRouter-specific routing, usage, reasoning, cache, and provider selection fields.
- `@opencode-ai/llm-provider-azure`: Azure resource/deployment URL policy and API-key/AAD auth.

Keep shared code in `@opencode-ai/llm`:

- Protocols such as OpenAI Chat, OpenAI Responses, Anthropic Messages, Gemini, and Bedrock Converse.
- Adapter primitives: `Adapter`, `Endpoint`, `Auth`, `Framing`, `Protocol`.
- Shared OpenAI-compatible profiles and helpers where they are broadly reusable.

Do not create one package per provider before the API is proven. Start with built-ins implementing the provider definition contract, then extract providers that have enough special logic or dependency weight to justify it.

## Dynamic Import Contract

Native provider package loading should be strict.

Accept:

```ts
export default Provider.make({ ... })
```

Optionally accept a named export for CommonJS or package-author convenience:

```ts
export const provider = Provider.make({ ... })
```

Reject packages that only export arbitrary functions like `createOpenAI`. A bare `model` export is useful for direct users, but the dynamic loader needs the full provider definition so it can validate `id` and select named `apis` uniformly.

Validation should check:

- `id` is a non-empty string.
- `model` is a function.
- `apis`, when present, is a record of functions.

Provider definitions should not receive secrets through global state. OpenCode passes `apiKey` or `auth` material explicitly through model options.

## Option Mapping

The OpenCode bridge owns translation from OpenCode/models.dev options into provider model options.

Provider definitions own provider-specific interpretation.

For example, OpenCode can pass:

```ts
{
  providerOptions: {
    openrouter: {
      usage: true,
      reasoning: { effort: "high" },
    },
  },
}
```

The OpenRouter provider decides how that becomes payload fields. Models.dev should not know the wire field names beyond declarative provider option defaults.

## Security And Operational Policy

Dynamic native plugins execute code. Treat them like current AI SDK provider packages:

- Only load packages named by user config, local models.dev metadata, or trusted models.dev metadata.
- Keep package installation in the existing npm cache/install mechanism.
- Do not load native plugin packages for the default native path unless native mode is enabled or the provider is explicitly allowlisted.
- Log provider package, version if available, provider ID, and available model APIs.
- Avoid printing secrets in plugin load failures.

## Migration Plan

1. Add `Provider.Definition`, `Provider.ModelOptions`, `Provider.ModelFactory`, and `Provider.make` to `@opencode-ai/llm`.
2. Add built-in provider definitions next to existing helper namespaces.
3. Replace OpenCode's native bridge provider table with a registry lookup against built-in plugins.
4. Keep the AI SDK package compatibility map as a fallback while models.dev metadata catches up.
5. Extend OpenCode's models.dev schemas to parse optional `opencode` metadata.
6. Add dynamic import support for `opencode.npm` behind the existing native feature flag.
7. Add deterministic tests for built-in registry resolution, dynamic plugin loading, validation failures, and AI SDK fallback.
8. Update models.dev to emit native metadata for built-in providers.
9. Dogfood external package loading with one provider package before documenting the contract as stable.
10. Extract heavier providers into subpackages only after the contract survives OpenCode integration.

## Open Questions

- Should provider `model` return `Effect.Effect<ModelRef, LLMError>` instead of a synchronous value? Synchronous is simpler and matches current helpers, but Vertex/AWS credential discovery may eventually prefer Effect.
- Should `opencode.api` be a generic hint, or should each provider define its own accepted metadata shape? Generic hints are easier for models.dev, but provider-specific metadata is more type-accurate.
- Should external provider packages depend on `@opencode-ai/llm` as a peer dependency to avoid duplicate adapter registries? Probably yes.
- Should the native path allow custom local `file://` plugin packages the same way the AI SDK path does? Probably yes for development and enterprise providers.

## Recommendation

Build the native provider definition contract before adding many more one-off bridge mappings.

Keep the current bridge as migration glue, but make built-ins implement the same `Provider.Definition` contract intended for third-party packages. That gives OpenCode a clean long-term story:

- AI SDK metadata keeps powering the existing path.
- Native metadata selects native providers.
- Built-ins and external packages use the same interface.
- Provider-specific behavior lives in code, not in `models.dev` data.
- Third-party providers can plug in without OpenCode guessing export names or copying AI SDK's contract by accident.
