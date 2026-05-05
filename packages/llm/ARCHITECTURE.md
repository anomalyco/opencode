# LLM Architecture

This package has one public shape:

```ts
const model = OpenAI.model("gpt-4o-mini", { apiKey })
const response = yield* LLM.generate({ model, prompt: "Say hello." })
```

Everything below explains how that stays simple while still supporting OpenAI, Anthropic, Gemini, Bedrock, OpenRouter, Azure, local OpenAI-compatible gateways, provider quirks, hosted tools, cache hints, and request replay.

Read this document as terraces. Stop when the next layer is not useful for your task.

| Terrace | You need this when... |
| --- | --- |
| 1. Use the API | You are writing application code or examples. |
| 2. Choose a route | You need to understand why provider, model, and protocol are separate. |
| 3. Follow a request | You are debugging what happens after `LLM.generate`. |
| 4. Add a provider | You are wiring a new deployment or protocol. |
| 5. Patch a quirk | You are preserving provider-specific behavior without polluting common schemas. |
| 6. Compare designs | You are relating this to AI SDK or OpenCode's current provider stack. |

## Terrace 1: Use The API

Most code should live here.

```ts
import { Effect, Layer } from "effect"
import { LLM, RequestExecutor } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"

const model = OpenAI.model("gpt-4o-mini", {
  apiKey: Bun.env.OPENAI_API_KEY,
})

const program = Effect.gen(function* () {
  const response = yield* LLM.generate({
    model,
    prompt: "Say hello.",
  })

  console.log(response.text)
}).pipe(
  Effect.provide(Layer.mergeAll(
    LLM.layer(),
    RequestExecutor.defaultLayer,
  )),
)
```

The public rule is:

```txt
provider helper -> model handle -> LLM.generate / LLM.stream
```

Provider helpers should feel boring at use sites.

```ts
OpenAI.model("gpt-4o-mini", { apiKey })
Anthropic.model("claude-3-5-sonnet-latest", { apiKey })
Google.model("gemini-2.0-flash", { apiKey })
OpenRouter.model("openai/gpt-4o-mini", { apiKey })
OpenAICompatible.model("gpt-4o-mini", {
  provider: "local-gateway",
  baseURL: "http://localhost:11434/v1",
})
```

For OpenAI, `OpenAI.model(...)` means Responses. Use `OpenAI.chat(...)` only when you specifically need Chat Completions.

<details>
<summary>What this terrace intentionally hides</summary>

The call site does not name adapters, protocols, endpoints, auth, framing, patches, provider payloads, or stream parsers.

Those things are runtime concerns. They should be inspectable and composable, but not required for normal use.
</details>

## Terrace 2: Choose A Route

A model reference is a route card. It says which model to call, which provider owns the deployment, and which wire protocol can talk to it.

```txt
OpenAI.model("gpt-4o-mini", { apiKey })
  -> provider: openai
  -> protocol: openai-responses
  -> id: gpt-4o-mini

OpenRouter.model("openai/gpt-4o-mini", { apiKey })
  -> provider: openrouter
  -> protocol: openai-compatible-chat
  -> id: openai/gpt-4o-mini

OpenAICompatible.model("gpt-4o-mini", { provider: "local-gateway", baseURL })
  -> provider: local-gateway
  -> protocol: openai-compatible-chat
  -> id: gpt-4o-mini
```

This split is the core design choice.

| Concept | Question it answers |
| --- | --- |
| `provider` | Who is the deployment or product surface? |
| `protocol` | Which request/response shape should the runtime use? This is an open string so custom providers can add new protocol ids. |
| `id` | Which model/deployment id should be sent? |
| `baseURL` | Where should HTTP go? |
| `apiKey`, `headers`, `queryParams`, `native` | What deployment-specific transport data is needed? |
| `capabilities`, `limits` | What normalized features and constraints should callers see? |

Provider identity and wire protocol often differ. OpenRouter is not OpenAI, but many OpenRouter models speak enough OpenAI Chat shape to reuse the OpenAI Chat protocol.

<details>
<summary>Conceptual ModelRef shape</summary>

```ts
type ModelRef = {
  id: ModelID
  provider: ProviderID
  protocol: ProtocolID
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  queryParams?: Record<string, string>
  capabilities: ModelCapabilities
  limits: ModelLimits
  native?: Record<string, unknown>
}
```

`ModelRef` is the stable, serializable description of what should be called. Provider helpers also bind an in-memory adapter to the returned model handle so direct call sites do not need to manually register adapters; serialized copies fall back to `model.protocol` registry lookup.
</details>

## Terrace 3: Follow A Request

At runtime, the flow is a staircase.

```txt
LLM.generate({ model, prompt })
  -> LLM.request(...)
  -> LLMClient
  -> adapter from the model handle, or explicit registry fallback
  -> provider-native payload
  -> HttpClientRequest
  -> RequestExecutor
  -> provider response stream
  -> LLMEvent stream
  -> LLMResponse
```

The high-level API hides that pipeline.

```ts
const response = yield* LLM.generate({
  model: OpenAI.model("gpt-4o-mini", { apiKey }),
  prompt: "Say hello.",
})
```

The lower-level runtime sees this shape.

```ts
const request = LLM.request({
  model,
  prompt: "Say hello.",
})

const client = LLMClient.make({
  adapters: [],
  patches: ProviderPatch.defaults,
})

const response = yield* client.generate(request)
```

<details>
<summary>Adapter pipeline</summary>

Explicit adapters passed to `LLMClient.make(...)` win first. If no explicit adapter matches, the adapter bound to the in-memory model handle is used. If the model was serialized and revived, `LLMClient` falls back to the explicit registry keyed by `request.model.protocol`.

```ts
const adapter = adapters.get(request.model.protocol) ?? modelAdapters.get(request.model)
const candidate = adapter.prepare(request)
const patched = applyPayloadPatches(candidate)
const payload = adapter.validate(patched)
const http = adapter.toHttp(payload)
const response = yield* RequestExecutor.execute(http)
const events = adapter.parse(response)
```

`generate` collects the same `LLMEvent` stream that `stream` exposes incrementally.
</details>

### How Adapter Is Used Today

Keeping the current names, an `Adapter` is the runnable implementation for one registered request route.

It is selected from the model handle when the provider helper created the model in the same process. Explicit adapter registration overrides that default and remains the fallback for revived models, OpenCode config bridges, and low-level tests.

```ts
const adapters = new Map(
  options.adapters.map((adapter) => [adapter.protocol, adapter] as const),
)

const adapter = adapters.get(request.model.protocol) ?? modelAdapters.get(request.model)
```

That means `protocol` has two jobs only in fallback paths:

| Job | Example |
| --- | --- |
| Describes the wire API shape | `openai-responses`, `anthropic-messages`, `gemini`. |
| Selects the adapter after serialization | `LLMClient` looks up `adapters.get(request.model.protocol)`. |

The adapter then owns the full compile/run boundary for that selected route.

| Adapter field | Used for |
| --- | --- |
| `id` | Human/debug name, prepared request metadata, patch namespace. |
| `protocol` | Registry key used by `LLMClient` lookup. |
| `patches` | Adapter-local payload patches. |
| `prepare(request)` | Lowers common `LLMRequest` into a provider-native payload candidate. |
| `validate(candidate)` | Validates and normalizes the payload candidate with the protocol payload schema. |
| `toHttp(payload, context)` | Builds the real `HttpClientRequest`. |
| `parse(response)` | Converts the provider response stream into common `LLMEvent`s. |

`Adapter.make(...)` is the normal constructor. It builds those methods by composing four pieces.

```txt
Adapter.make(...)
  = Protocol.prepare / payload Schema / chunk Schema / process
  + Endpoint URL construction
  + Auth header/signing behavior
  + Framing bytes-to-frames behavior
```

`Protocol` no longer has a separate `encode` function in the normal path. The adapter validates payload patches and JSON-encodes the final payload from `protocol.payload`.

So the current relationship is:

```txt
ModelRef.protocol
  -> selects Adapter after serialization / registry lookup
  -> Adapter composes Protocol + Endpoint + Auth + Framing
  -> Adapter compiles the request and parses the response
```

`model.provider` is still useful, but it is not the adapter lookup key. It identifies the deployment/product surface for defaults, capabilities, provider-specific options, patch predicates, debugging, telemetry, and OpenCode provider parity.

The odd-looking case is OpenAI-compatible Chat. It reuses the OpenAI Chat protocol implementation, but registers under a different protocol id.

```txt
OpenAICompatible.model(...)
  -> provider: local-gateway
  -> protocol: openai-compatible-chat

OpenAI-compatible adapter
  -> registry key: openai-compatible-chat
  -> reused Protocol implementation: OpenAIChat.protocol
  -> custom Endpoint/Auth/Framing deployment axes
```

That keeps provider identity separate from the reusable wire behavior, even though the current `protocol` name is carrying both “wire shape” and “adapter lookup key” meaning.

## Terrace 4: Add A Provider

Provider behavior is split across reusable layers instead of one large provider class.

```txt
Provider helper
  creates model handles backed by ModelRef values

Provider module
  exports adapters and helper constructors

Adapter
  composes Protocol + Endpoint + Auth + Framing

Protocol
  owns provider-native request and stream semantics
```

The composition rule is:

```txt
Adapter = Protocol + Endpoint + Auth + Framing
```

OpenAI Chat is a normal adapter composition.

```ts
export const adapter = Adapter.make({
  id: "openai-chat",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.baseURL({
    default: "https://api.openai.com/v1",
    path: "/chat/completions",
  }),
  auth: Auth.openAI,
  framing: Framing.sse,
})
```

OpenAI-compatible Chat is the same protocol with different deployment axes.

```txt
OpenAI-compatible Chat adapter
  = OpenAIChat.protocol
  + required baseURL endpoint
  + bearer auth
  + SSE framing
```

That is why these can share implementation without pretending they are the same provider.

```ts
OpenAI.chat("gpt-4o-mini", { apiKey })
OpenRouter.model("openai/gpt-4o-mini", { apiKey })
OpenAICompatible.model("gpt-4o-mini", { provider: "local-gateway", baseURL })
```

<details>
<summary>Layer responsibilities</summary>

| Layer | Owns |
| --- | --- |
| Provider helper | Public constructor, defaults, provider identity, model capabilities, limits, in-process adapter binding. |
| Provider module | Exported adapters and helpers for explicit registry fallback. |
| Adapter | Runtime registration and composition. |
| Protocol | Request lowering, payload schema, chunk schema, stream state machine. |
| Endpoint | URL construction, base URL, path, query params, deployment routing. |
| Auth | Bearer tokens, API-key headers, SigV4, future IAM/AAD signing. |
| Framing | Bytes to frames before protocol parsing, usually SSE. |
</details>

<details>
<summary>When to add what</summary>

| Need | Add |
| --- | --- |
| A new hosted product speaks an existing protocol | Provider helper plus adapter composition. |
| A provider has a unique request/response shape | New protocol plus adapter composition. |
| A provider has the same protocol but different auth | Reuse protocol, add auth axis. |
| A provider has the same protocol but different URL rules | Reuse protocol, add endpoint axis. |
| A provider streams non-SSE frames | Reuse or add protocol, add framing axis. |
| A model needs a one-off body tweak | Patch, not a common schema field. |
</details>

## Terrace 5: Patch A Quirk

Patches are named, traceable provider/model transformations inspired by OpenCode's existing `ProviderTransform` layer.

Use a patch when behavior is real but not universal enough to belong in the common request schema.

```txt
cache.prompt-hints
anthropic.scrub-tool-call-ids
payload.openai-chat.include-usage
```

Each patch has an id, phase, predicate, and reason. Applied patches appear in `patchTrace`.

Patches are not a routing mechanism. Adapter selection happens from the original `request.model`; request patches may change payload details, but changing `model.provider`, `model.id`, or `model.protocol` is rejected. If a call needs a different provider, model, or protocol, construct a different model handle before building the request.

The rule is:

```txt
Common request shape stays small.
Provider quirks stay named and auditable.
Model routing stays explicit at the call site.
```

Good patch candidates include cache hint lowering, model-specific reasoning fields, OpenAI-compatible message cleanup, hosted-tool shape differences, metadata extraction, and provider option namespacing.

Bad patch candidates are behaviors that every provider supports the same way. Those belong in the common request model.

### OpenCode Transform Map

The native patch layer exists to preserve the behavior OpenCode previously centralized in `packages/opencode/src/provider/transform.ts`, but with named phases and `patchTrace` entries.

1. Empty Anthropic / Bedrock content

   Old OpenCode shape:

   ```ts
   // ProviderTransform.normalizeMessages(...)
   if (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/amazon-bedrock") {
     msgs = msgs
       .map((msg) => removeEmptyTextAndReasoningParts(msg))
       .filter((msg) => msg.content !== "" && msg.content.length > 0)
   }
   ```

   Native shape:

   ```ts
   ProviderPatch.removeEmptyAnthropicContent
   // prompt.anthropic.remove-empty-content
   ```

   Status: ported default prompt patch. Anthropic and Bedrock reject empty text/reasoning blocks, so this stays as a provider/model quirk instead of forbidding empty content in the common request model.

2. Claude tool-call id scrub

   Old OpenCode shape:

   ```ts
   // ProviderTransform.normalizeMessages(...)
   if (model.api.id.includes("claude")) {
     toolCallId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_")
   }
   ```

   Native shape:

   ```ts
   ProviderPatch.scrubClaudeToolIds
   // prompt.anthropic.scrub-tool-call-ids
   ```

   Status: ported default prompt patch. The common request model can preserve original tool ids; Claude-specific transport constraints are applied late and traced.

3. Mistral / Devstral tool-call id scrub

   Old OpenCode shape:

   ```ts
   // ProviderTransform.normalizeMessages(...)
   if (model.providerID === "mistral" || model.api.id.includes("devstral")) {
     toolCallId = toolCallId.replace(/[^a-zA-Z0-9]/g, "").substring(0, 9).padEnd(9, "0")
   }
   ```

   Native shape:

   ```ts
   ProviderPatch.scrubMistralToolIds
   // prompt.mistral.scrub-tool-call-ids
   ```

   Status: partially ported default prompt patch. The id scrub is ported. The old OpenCode message-sequence repair for `tool -> user` is still an OpenCode parity TODO.

4. Prompt caching markers

   Old OpenCode shape:

   ```ts
   // ProviderTransform.applyCaching(...)
   const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
   const final = msgs.filter((msg) => msg.role !== "system").slice(-2)
   for (const msg of unique([...system, ...final])) {
     msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerCacheOptions)
   }
   ```

   Native shape:

   ```ts
   ProviderPatch.cachePromptHints
   // prompt.cache.prompt-hints
   ```

   Status: ported default prompt patch. The patch marks the first two system parts and last two messages with a common `CacheHint`. Adapters lower that hint to provider-native shapes like Anthropic `cache_control` or Bedrock `cachePoint`.

5. Gemini tool-schema sanitization

   Old OpenCode shape:

   ```ts
   // ProviderTransform.schema(...)
   if (model.providerID === "google" || model.api.id.includes("gemini")) {
     schema = sanitizeGemini(schema)
   }
   ```

   Native shape:

   ```ts
   // packages/llm/src/provider/gemini.ts
   lowerToolSchema(tool.inputSchema)
   ```

   Status: ported inside `Gemini.protocol`, not as a registered patch. Gemini has a distinct schema dialect, so the adapter owns both the historical sanitizer and the lossy projection into Gemini's accepted keys.

6. OpenAI Chat / OpenAI-compatible streaming usage

   Old OpenCode shape:

   ```ts
   // ProviderTransform.options(...), provider-specific option shaping
   result["usage"] = { include: true }
   ```

   Native shape:

   ```ts
   OpenAIChat.adapter.patch("include-usage", ...)
   OpenAICompatibleChat.adapter.patch("include-usage", ...)
    // payload.openai-chat.include-usage
   ```

    Status: ported as adapter-local payload patches. This is payload shape, not common request shape.

7. DeepSeek reasoning replay and interleaved reasoning fields

   Old OpenCode shape:

   ```ts
   // ProviderTransform.normalizeMessages(...)
   if (model.api.id.toLowerCase().includes("deepseek")) {
     assistant.content.push({ type: "reasoning", text: "" })
   }
   if (model.capabilities.interleaved?.field) {
     msg.providerOptions.openaiCompatible[field] = reasoningText
   }
   ```

   Native shape: TODO.

   Status: not ported yet. This should become provider-specific history shaping without exposing OpenAI-compatible reasoning internals globally.

8. Provider option namespacing

   Old OpenCode shape:

   ```ts
   // ProviderTransform.providerOptions(...)
   if (model.api.npm === "@ai-sdk/gateway") return { gateway, [upstreamSlug]: rest }
   if (model.api.npm === "@ai-sdk/azure") return { openai: options, azure: options }
   return { [sdkKey(model.api.npm) ?? model.providerID]: options }
   ```

   Native shape: TODO; the native OpenCode bridge currently falls back when prepared provider options are non-empty.

   Status: not ported yet. These options are deployment/provider specific and should remain outside the common request model.

9. Model-specific reasoning defaults

   Old OpenCode shape:

   ```ts
   // ProviderTransform.options(...) and variants(...)
   result["thinkingConfig"] = { includeThoughts: true }
   result["enable_thinking"] = true
   result["reasoningSummary"] = "auto"
   result["include"] = ["reasoning.encrypted_content"]
   ```

   Native shape: partly represented by `request.reasoning`; provider-native defaults are still TODO.

   Status: not fully ported. Some models need native knobs that do not belong in the universal request shape.

## Terrace 6: Compare Designs

AI SDK has an excellent use-site shape.

```ts
openai("gpt-4o-mini")
openai.chat("gpt-4o-mini")
createOpenAICompatible({ baseURL })("gpt-4o-mini")
```

This package keeps the use-site shape familiar.

```ts
OpenAI.model("gpt-4o-mini", { apiKey })
OpenAI.chat("gpt-4o-mini", { apiKey })
OpenAICompatible.model("gpt-4o-mini", { provider, baseURL, apiKey })
```

The difference is below the public API.

| Concern | AI SDK | This package |
| --- | --- | --- |
| Use site | Provider creates runnable model object. | Provider creates a runnable model handle backed by serializable `ModelRef`. |
| Provider implementation | Usually provider-package-specific language model classes. | Protocol, endpoint, auth, framing, and patches are separate axes. |
| OpenAI-compatible reuse | Dedicated OpenAI-compatible implementation. | Reuses `OpenAIChat.protocol` with different deployment axes. |
| Debug/replay/parity | Mostly hidden behind provider implementation. | Exposed through request lowering, patches, adapters, and events. |

The tradeoff is intentional. The public API should feel small. The internals should be inspectable enough for OpenCode to preserve provider parity, replay HTTP, diff native payloads, and migrate provider-by-provider without cloning whole adapter classes.

### OpenCode Provider Loading

OpenCode's current AI SDK path is more dynamic than this package's native path.

```txt
OpenCode config/models.dev
  -> model.api.npm
  -> import or install AI SDK provider package
  -> create provider SDK
  -> sdk.languageModel(...) / sdk.responses(...) / sdk.chat(...)
```

That is why OpenCode can point at many AI SDK provider packages without this repo shipping a native adapter for each one.

The `@opencode-ai/llm` native path currently works in two modes:

| Mode | How it works | Good for |
| --- | --- | --- |
| In-process model helper | `OpenAI.model(...)`, `OpenAICompatible.model(...)`, or a third-party helper returns a model handle bound to an adapter. | Library users and code that imports the provider package directly. |
| Explicit adapter registry | `LLMClient.make({ adapters: [...] })` maps revived `ModelRef.protocol` values to shipped adapters. | OpenCode config/models.dev bridges, tests, request replay, serialized models. |

So OpenCode native integration is not “import any AI SDK provider package and it just works” yet. Today it supports protocols/providers that the OpenCode bridge can map to known native model helpers and adapters, plus generic OpenAI-compatible deployments. A config-defined provider with `@ai-sdk/openai-compatible` can map to `openai-compatible-chat`; a brand-new protocol needs a native adapter and bridge mapping.

The core package is now open enough for external protocols: `ProtocolID` is just a string, so a third-party package can define `Protocol.define(...)`, `Adapter.make(...)`, and a model helper without changing this package. To make OpenCode load those from config the same way it loads AI SDK packages, we would add an explicit native-provider loader/registry analogous to the AI SDK `model.api.npm` loader.
