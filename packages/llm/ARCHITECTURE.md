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
    LLM.layer({ providers: [OpenAI] }),
    RequestExecutor.defaultLayer,
  )),
)
```

The public rule is:

```txt
provider helper -> model reference -> LLM.generate / LLM.stream
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

The call site does not name adapters, protocols, endpoints, auth, framing, patches, target payloads, or stream parsers.

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
| `protocol` | Which request/response shape should the runtime use? |
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

`ModelRef` is not a provider client. It does not send requests. It is the stable, serializable description of what should be called.
</details>

## Terrace 3: Follow A Request

At runtime, the flow is a staircase.

```txt
LLM.generate({ model, prompt })
  -> LLM.request(...)
  -> LLMClient
  -> adapter selected by model.protocol
  -> provider-native target payload
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
  adapters: [OpenAIResponses.adapter, OpenAIChat.adapter],
  patches: ProviderPatch.defaults,
})

const response = yield* client.generate(request)
```

<details>
<summary>Adapter pipeline</summary>

The adapter is selected by `request.model.protocol`.

```ts
const adapter = adapters.get(request.model.protocol)
const candidate = adapter.prepare(request)
const patched = applyTargetPatches(candidate)
const target = adapter.validate(patched)
const http = adapter.toHttp(target)
const response = yield* RequestExecutor.execute(http)
const events = adapter.parse(response)
```

`generate` collects the same `LLMEvent` stream that `stream` exposes incrementally.
</details>

### How Adapter Is Used Today

Keeping the current names, an `Adapter` is the runnable implementation for one registered request route.

It is selected by `model.protocol`, not by `model.provider`.

```ts
const adapters = new Map(
  options.adapters.map((source) => [source.runtime.protocol, source.runtime] as const),
)

const adapter = adapters.get(request.model.protocol)
```

That means `protocol` currently has two jobs:

| Job | Example |
| --- | --- |
| Describes the wire API shape | `openai-responses`, `anthropic-messages`, `gemini`. |
| Selects the runtime adapter | `LLMClient` looks up `adapters.get(request.model.protocol)`. |

The adapter then owns the full compile/run boundary for that selected route.

| Adapter field | Used for |
| --- | --- |
| `id` | Human/debug name, prepared request metadata, patch namespace. |
| `protocol` | Registry key used by `LLMClient` lookup. |
| `patches` | Adapter-local target patches. |
| `prepare(request)` | Lowers common `LLMRequest` into a provider-native target candidate. |
| `validate(candidate)` | Validates and normalizes the target candidate with the protocol target schema. |
| `toHttp(target, context)` | Builds the real `HttpClientRequest`. |
| `parse(response)` | Converts the provider response stream into common `LLMEvent`s. |

`Adapter.fromProtocol(...)` is the normal constructor. It builds those methods by composing four pieces.

```txt
Adapter.fromProtocol(...)
  = Protocol.prepare / target Schema / chunk Schema / process
  + Endpoint URL construction
  + Auth header/signing behavior
  + Framing bytes-to-frames behavior
```

`Protocol` no longer has a separate `encode` function in the normal path. The adapter validates target patches and JSON-encodes the final target from `protocol.target`.

So the current relationship is:

```txt
ModelRef.protocol
  -> selects Adapter
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
  creates ModelRef values

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
export const adapter = Adapter.fromProtocol({
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
| Provider helper | Public constructor, defaults, provider identity, model capabilities, limits. |
| Provider module | Exported adapters and helpers passed to `LLM.layer({ providers })`. |
| Adapter | Runtime registration and composition. |
| Protocol | Request lowering, target schema, chunk schema, stream state machine. |
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

Patches are named, traceable provider/model transformations.

Use a patch when behavior is real but not universal enough to belong in the common request schema.

```txt
cache.prompt-hints
anthropic.scrub-tool-call-ids
target.openai-chat.include-usage
```

Each patch has an id, phase, predicate, and reason. Applied patches appear in `patchTrace`.

The rule is:

```txt
Common request shape stays small.
Provider quirks stay named and auditable.
```

Good patch candidates include cache hint lowering, model-specific reasoning fields, OpenAI-compatible message cleanup, hosted-tool shape differences, metadata extraction, and provider option namespacing.

Bad patch candidates are behaviors that every provider supports the same way. Those belong in the common request model.

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
| Use site | Provider creates runnable model object. | Provider creates `ModelRef`; `LLM` runtime runs it. |
| Provider implementation | Usually provider-package-specific language model classes. | Protocol, endpoint, auth, framing, and patches are separate axes. |
| OpenAI-compatible reuse | Dedicated OpenAI-compatible implementation. | Reuses `OpenAIChat.protocol` with different deployment axes. |
| Debug/replay/parity | Mostly hidden behind provider implementation. | Exposed through request lowering, patches, adapters, and events. |

The tradeoff is intentional. The public API should feel small. The internals should be inspectable enough for OpenCode to preserve provider parity, replay HTTP, diff native payloads, and migrate provider-by-provider without cloning whole adapter classes.
