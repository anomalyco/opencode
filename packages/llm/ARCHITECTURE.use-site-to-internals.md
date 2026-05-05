# LLM Architecture

This package has one public shape:

```ts
const model = OpenAI.model("gpt-4o-mini", { apiKey })
const response = yield * LLM.generate({ model, prompt: "Say hello." })
```

Everything below explains how that stays simple while still supporting OpenAI, Anthropic, Gemini, Bedrock, OpenRouter, Azure, local OpenAI-compatible gateways, provider quirks, hosted tools, cache hints, and request replay.

Read from top to bottom. Stop when the next section is deeper than your task requires.

| Section                         | Use it when...                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------- |
| 1. The API You Use              | You are writing application code or examples.                                   |
| 2. What A Model Reference Means | You need to understand why provider, model, and protocol are separate.          |
| 3. What Happens At Runtime      | You are debugging what happens after `LLM.generate`.                            |
| 4. How Providers Are Built      | You are wiring a new deployment or protocol.                                    |
| 5. How Quirks Are Handled       | You are preserving provider-specific behavior without polluting common schemas. |
| 6. Why This Design              | You are relating this to AI SDK or OpenCode's current provider stack.           |

## 1. The API You Use

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
}).pipe(Effect.provide(Layer.mergeAll(LLM.layer({ providers: [OpenAI] }), RequestExecutor.defaultLayer)))
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
  name: "local-gateway",
  baseURL: "http://localhost:11434/v1",
})
```

For OpenAI, `OpenAI.model(...)` means Responses. Use `OpenAI.chat(...)` only when you specifically need Chat Completions.

<details>
<summary>What this section hides</summary>

The call site does not name adapters, protocols, endpoints, auth, framing, patches, target payloads, or stream parsers.

Those are runtime concerns. They should be inspectable and composable, but not required for normal use.

</details>

## 2. What A Model Reference Means

A model reference is a route card. It says which model to call, which provider owns the deployment, and which wire protocol can talk to it.

```ts
OpenAI.model("gpt-4o-mini", { apiKey })
  -> provider: openai
  -> protocol: openai-responses
  -> id: gpt-4o-mini

OpenRouter.model("openai/gpt-4o-mini", { apiKey })
  -> provider: openrouter
  -> protocol: openai-compatible-chat
  -> id: openai/gpt-4o-mini

OpenAICompatible.model("gpt-4o-mini", { name: "local-gateway", baseURL })
  -> provider: local-gateway
  -> protocol: openai-compatible-chat
  -> id: gpt-4o-mini
```

This split is the core design choice.

| Concept                                      | Question it answers                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| `provider`                                   | Who is the deployment or product surface?                    |
| `protocol`                                   | Which request/response shape should the runtime use?         |
| `id`                                         | Which model/deployment id should be sent?                    |
| `baseURL`                                    | Where should HTTP go?                                        |
| `apiKey`, `headers`, `queryParams`, `native` | What deployment-specific transport data is needed?           |
| `capabilities`, `limits`                     | What normalized features and constraints should callers see? |

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

## 3. What Happens At Runtime

At runtime, every request follows the same path.

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
const response =
  yield *
  LLM.generate({
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

const response = yield * client.generate(request)
```

<details>
<summary>Adapter pipeline</summary>

The adapter is selected by `request.model.protocol`.

```ts
const adapter = adapters.get(request.model.protocol)
const draft = adapter.prepare(request)
const patched = applyTargetPatches(draft)
const target = adapter.validate(patched)
const http = adapter.toHttp(target)
const response = yield * RequestExecutor.execute(http)
const events = adapter.parse(response)
```

`generate` collects the same `LLMEvent` stream that `stream` exposes incrementally.

</details>

## 4. How Providers Are Built

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
OpenAICompatible.model("gpt-4o-mini", { name: "local-gateway", baseURL })
```

<details>
<summary>Layer responsibilities</summary>

| Layer           | Owns                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| Provider helper | Public constructor, defaults, provider identity, model capabilities, limits.              |
| Provider module | Exported adapters and helpers passed to `LLM.layer({ providers })`.                       |
| Adapter         | Runtime registration and composition.                                                     |
| Protocol        | Request lowering, target schema, chunk schema, stream state machine. |
| Endpoint        | URL construction, base URL, path, query params, deployment routing.                       |
| Auth            | Bearer tokens, API-key headers, SigV4, future IAM/AAD signing.                            |
| Framing         | Bytes to frames before protocol parsing, usually SSE.                                     |

</details>

<details>
<summary>When to add what</summary>

| Need                                                     | Add                                       |
| -------------------------------------------------------- | ----------------------------------------- |
| A new hosted product speaks an existing protocol         | Provider helper plus adapter composition. |
| A provider has a unique request/response shape           | New protocol plus adapter composition.    |
| A provider has the same protocol but different auth      | Reuse protocol, add auth axis.            |
| A provider has the same protocol but different URL rules | Reuse protocol, add endpoint axis.        |
| A provider streams non-SSE frames                        | Reuse or add protocol, add framing axis.  |
| A model needs a one-off body tweak                       | Patch, not a common schema field.         |

</details>

## 5. How Quirks Are Handled

Patches are named, traceable provider/model transformations inspired by OpenCode's existing `ProviderTransform` layer.

Use a patch when behavior is real but not universal enough to belong in the common request schema.

```txt
cache.prompt-hints
anthropic.scrub-tool-call-ids
target.openai-chat.include-usage
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

## 6. Why This Design

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
OpenAICompatible.model("gpt-4o-mini", { name, baseURL, apiKey })
```

The difference is below the public API.

| Concern                 | AI SDK                                                    | This package                                                      |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Use site                | Provider creates runnable model object.                   | Provider creates `ModelRef`; `LLM` runtime runs it.               |
| Provider implementation | Usually provider-package-specific language model classes. | Protocol, endpoint, auth, framing, and patches are separate axes. |
| OpenAI-compatible reuse | Dedicated OpenAI-compatible implementation.               | Reuses `OpenAIChat.protocol` with different deployment axes.      |
| Debug/replay/parity     | Mostly hidden behind provider implementation.             | Exposed through request lowering, patches, adapters, and events.  |

The tradeoff is intentional. The public API should feel small. The internals should be inspectable enough for OpenCode to preserve provider parity, replay HTTP, diff native payloads, and migrate provider-by-provider without cloning whole adapter classes.
