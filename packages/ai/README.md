# @opencode-ai/ai

Schema-first AI primitives for opencode. Provider quirks live in adapters, not in calling code.

```ts
import { Effect, Layer } from "effect"
import { LLM, LLMClient } from "@opencode-ai/ai"
import { RequestExecutor } from "@opencode-ai/ai/route"
import { OpenAI } from "@opencode-ai/ai/providers"

const model = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).responses("gpt-4o-mini")

const request = LLM.request({
  model,
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 40 },
})

const program = Effect.gen(function* () {
  const response = yield* LLMClient.generate(request)
  console.log(response.text)
})

const llmLayer = LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))

await Effect.runPromise(program.pipe(Effect.provide(llmLayer)))
```

Run `LLMClient.stream(request)` instead of `generate` when you want incremental `LLMEvent`s. The event stream is provider-neutral — same shape across OpenAI Chat, OpenAI Responses, Anthropic Messages, Gemini, Bedrock Converse, and any OpenAI-compatible deployment.

## Image generation

Use `Image.generate` with an image model for direct asset generation:

```ts
import { Image, ImageInput } from "@opencode-ai/ai"
import { OpenAI } from "@opencode-ai/ai/providers"

const program = Effect.gen(function* () {
  const response = yield* Image.generate({
    model: OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).image("gpt-image-2"),
    prompt: "A robot tending a rooftop garden",
    options: {
      n: 2,
      size: "1024x1024",
      quality: "high", // inferred from the OpenAI image model
      outputFormat: "webp",
      future_option: true, // unknown native options pass through unchanged
    },
  })

  return response.images // GeneratedImage[] with owned bytes or a provider URL
})
```

Pass ordered image inputs to the same method for editing, composition, or image-conditioned generation:

```ts
const response =
  yield *
  Image.generate({
    model,
    prompt: "Combine these product photos into one studio scene",
    images: [
      ImageInput.bytes(firstBytes, "image/png"),
      ImageInput.url("https://example.com/second.webp"),
      ImageInput.file("file_123"),
    ],
    options,
    http,
  })
```

`ImageInput.fileUri(uri, mediaType)` represents provider file URIs such as Gemini Files. Raw strings are not
accepted as image inputs, avoiding ambiguity between base64, URLs, and provider IDs. Empty or omitted `images`
uses text-to-image generation; a non-empty array selects the provider's edit behavior without enforcing provider
image-count limits locally. `images` is the only common image-editing field. OpenAI uses multipart for byte/data-URL
edits and its JSON reference body for URL or file-ID edits. Its provider-specific `options.mask` accepts an
`ImageInput` for inpainting:

```ts
yield *
  Image.generate({
    model: OpenAI.configure({ apiKey }).image("gpt-image-2"),
    prompt,
    images: [ImageInput.bytes(sourceBytes, "image/png")],
    options: { mask: ImageInput.bytes(maskBytes, "image/png") },
  })
```

The OpenAI adapter extracts this helper value into the edit request's native `mask` field rather than passing the
tagged `ImageInput` object through as an ordinary option. On multipart requests, `http.body` can override option
fields but not structural `model`, `prompt`, `image[]`, or `mask` fields, and the transport owns the multipart
`Content-Type` boundary. For JSON requests, `http.body` remains the final raw-native overlay. Gemini does not fetch
public HTTP URLs, and hosted Z.ai image generation does not accept image inputs. These cases fail with
`InvalidRequest` before network I/O.

Provider-native image options belong to each request. Raw `http.body` fields have final precedence over them:

```ts
const model = OpenAI.configure({ apiKey }).image("gpt-image-2")

yield *
  Image.generate({
    model,
    prompt,
    options: { quality: "medium" },
    http,
  })
```

xAI image models use the same request API with xAI-native controls:

```ts
yield *
  Image.generate({
    model: XAI.configure({ apiKey }).image("any-model-id"),
    prompt,
    options: {
      n: 2,
      aspectRatio: "16:9",
      resolution: "1k",
      responseFormat: "b64_json",
      future_option: true,
    },
    http,
  })
```

Google's current Gemini image models use the same direct API:

```ts
import { Google } from "@opencode-ai/ai/providers"

const googleProgram = Effect.gen(function* () {
  const response = yield* Image.generate({
    model: Google.configure({ apiKey }).image("any-model-id"),
    prompt: "A robot tending a rooftop garden",
    options: {
      aspectRatio: "16:9",
      imageSize: "2K",
      seed: 42,
      thinkingLevel: "HIGH",
      includeThoughts: true,
      futureOption: true,
    },
    http,
  })

  return response.images
})
```

Google image options are request-scoped and inferred from the selected model. Known fields autocomplete while
future string values and arbitrary native Gemini `generationConfig` fields remain available. Native fields override
their mapped aliases, and `http.body` is the final deep overlay. The selected model ID is sent to Gemini
`generateContent` without a local allowlist.

Z.ai image models infer open Z.ai-native options from the selected model:

```ts
yield *
  Image.generate({
    model: ZAI.configure({ apiKey }).image("any-model-id"),
    prompt,
    options: {
      quality: "hd",
      userID: "user-123",
      future_option: true,
    },
    http,
  })
```

Z.ai does not include trustworthy MIME metadata for output URLs, so generated images use
`application/octet-stream`. Output URLs expire after 30 days; download and persist them promptly if they must
remain available.

Conversational image generation remains part of the LLM interaction. OpenAI Responses exposes it through its hosted image tool:

```ts
const program = Effect.gen(function* () {
  const response = yield* LLM.generate(
    LLM.request({
      model: OpenAI.configure({ apiKey }).responses("gpt-5"),
      prompt: "Design a solarpunk rooftop garden, then show me.",
      tools: [OpenAI.imageGeneration({ quality: "high" })],
    }),
  )

  return response.message
})
```

The hosted result is represented as a provider-executed tool call and tool result. Its image is a `file` content item with a data URI, so retaining `response.message` preserves the generated image for continuation.

## Public API

- **`LLM.request({...})`** — build a provider-neutral `LLMRequest`. Accepts ergonomic inputs (`system: string`, `prompt: string`) that normalize into the canonical Schema classes.
- **`LLM.generate` / `LLM.stream`** — re-exported from `LLMClient` for one-import use.
- **`Message.user(...)` / `Message.assistant(...)` / `Message.tool(...)`** — message constructors from the canonical schema model.
- **`LanguageModel.make(...)` / `ToolCallPart.make(...)` / `ToolResultPart.make(...)` / `ToolDefinition.make(...)`** — model and tool-related constructors from the canonical schema model.
- **`LLMEvent.is.*`** — typed guards (`is.textDelta`, `is.toolCall`, `is.finish`, …) for filtering streams.
- **`Image.generate({...})`** — generate images through a provider-neutral image request and response model.
- **`ImageClient`** — Effect service and layer for image execution, parallel to `LLMClient`.

## Testing

Use the deterministic test client from `@opencode-ai/ai/testing` to script provider-neutral responses and inspect
the requests sent by code under test:

```ts
import { Effect } from "effect"
import { TestLLM } from "@opencode-ai/ai/testing"

const programWithTestClient = Effect.gen(function* () {
  const test = yield* TestLLM.Test
  yield* test.push(TestLLM.text("Hello from the test model", "text-1"))
  const result = yield* program
  console.log(yield* test.requests())
  return result
}).pipe(Effect.provide(TestLLM.testLayer()))
```

`testLayer()` provides the same object under `LLMClient.Service` and `TestLLM.Test`. Production consumes the
normal client; tests use the additional controls. Each layer build has fresh state.

- `test.push(...)` queues one-shot responses in execution order. Each argument is one response.
- `test.always(response)` installs a repeatable fallback. The layer's `fallback` option sets its initial value.
- `test.serve(request => response)` installs a request-dependent fallback. `always` and `serve` replace each
  other without changing queued replies; queued replies take precedence.
- `test.requests()` returns an array snapshot. `transformRequest` changes only the recorded observation;
  `serve` receives the original canonical request.
- `test.wait(count)` waits for request arrivals, not output or completion, and supports concurrent waiters.
- `test.gate()` returns a scoped gate with countable `started` notifications and a `release` Effect. Release
  unblocks all requests captured by that gate; closing its scope also releases it. Effect-aware test runners
  already provide Scope.

Constructing `stream()` or `generate()` does not record a request, invoke a responder, or consume a script.
Each execution does. An exhausted queue without a fallback defects immediately rather than waiting for a
future reply.

Generation responses remain canonical event arrays or arbitrary `Stream<LLMEvent, AIError>` values. The client consumes
supplied streams directly, preserving failure identity, finalizers, incomplete output, and post-finish tails;
it does not repair or truncate them.

For explicit compaction, script a `CompactionResponse` through `push`, `always`, or `serve`. Its `replacement` contains the next context window, including retained user messages. The client returns that result and usage directly, with the same lazy request recording and gates. Generation and compaction reject fixtures for the wrong operation instead of converting between response shapes.

For `compact(request, { mechanism: "trigger" })`, script a `CompactionCheckpointResponse` instead. It carries `checkpoint`, `responseID`, and optional `usage`. Endpoint and trigger calls reject each other's fixtures; both share the same queue, gates, lazy recording, and fallback controls.

The published legacy `Service`, `layer`, `clientLayer`, and module-level controls remain available as adapters
over the same implementation, including the legacy live `requests` array. New tests should use `Test` and
`testLayer`.

## Provider compaction

Compaction is opt-in. The package supports automatic compaction in OpenAI/Azure Responses and Anthropic Messages (including Claude on Vertex), and explicit compaction calls in OpenAI/Azure/xAI Responses. Model and deployment support still depends on the provider. Bedrock compaction is deferred to a separate follow-up.

This is different from prompt caching, server-side history storage, or truncation. Compaction returns provider-owned context that must be replayed to continue the conversation.

### Explicit compaction

`LLMClient.compact(request)` (equivalently, `{ mechanism: "endpoint" }`) is the caller-controlled operation for OpenAI, Azure, and xAI Responses. It performs exactly one HTTP call to `/responses/compact`, using the selected route's endpoint, credentials, query, and HTTP middleware. It returns a `CompactionResponse` with `replacement: Message[]` and optional `usage`, not a normal generation response. This mechanism does not accept a WebSocket executor.

Prefer this operation, where supported, when the application owns compaction policy and durable context updates.

```ts
const result = yield * LLMClient.compact(request)
const next = LLMRequest.update(request, {
  messages: result.replacement,
})
const response = yield * LLMClient.generate(next)
```

`replacement` replaces the complete input window. Do not append it to the original transcript or extract only the encrypted item: the provider may retain additional messages in its output. Retained user and assistant messages remain ordinary messages with typed text, media, or reasoning parts, in their original order. Provider-specific message IDs, status, and phase use `providerMetadata`, not a raw output array hidden in an assistant message. Unsupported returned item types fail explicitly.

The selected model carries explicit-compaction capability through request construction and updates. Calls using unsupported routes fail type checking. When the model is selected dynamically, narrow the request with `LLMClient.canCompact(request)` before calling `LLMClient.compact`; a model or route switch does not inherit the old capability. Runtime validation still rejects unsupported calls from untyped consumers. Capability describes the route's API, not whether every model or custom deployment supports the operation.

Generation-only body overlays such as `stream` and `store` are not sent to the compact endpoint. Supported compact controls such as service tier and prompt-cache settings preserve request defaults and HTTP-overlay precedence. Retained image and file detail settings survive serialization and replay.

The input must still fit the model's context window. Explicit compaction is not an overflow-recovery operation. Anthropic does not expose this operation in this package; its in-band compaction remains available below. Compatible routes do not inherit an explicit compact endpoint simply because they use a Responses protocol.

### Streamed checkpoint compaction

OpenAI Responses also exposes a separate, explicitly selected mechanism:

```ts
const result =
  yield *
  LLMClient.compact(request, {
    mechanism: "trigger",
    webSocket, // Optional: without it, the request uses HTTP/SSE.
  })

result.checkpoint // Successful encrypted CompactionPart.
result.responseID
result.usage
```

This appends a native `compaction_trigger` control item to the full input and sends a normal Responses request. It follows the [Codex V2 request shape](https://github.com/openai/codex/blob/728cb12/codex-rs/core/src/compact_remote_v2_attempt.rs), with tools and instructions retained, `stream: true`, `store: false`, and parallel tool calls enabled. It removes normal-answer text/output-format controls, forced tool choices, output-token/tool-call limits, and automatic `context_management`. Body overlays cannot replace `input` or supply `previous_response_id`/`conversation`; the complete canonical history is required for safe stateless replay. Session/cache identifiers, auth, headers, query parameters, service tier, and supported prompt-cache settings are preserved.

Only a successful `response.completed` with a response ID and exactly one logical encrypted checkpoint succeeds. Repeated item events are correlated by ID/output slot, including ID-less checkpoints. Other output is ignored, not returned as assistant text or dispatched as tools. Failed, incomplete, malformed, and interrupted responses return errors rather than partial checkpoints.

The result is **not a replacement window**. The caller selects retained history, combines it with `result.checkpoint`, and durably installs it before continuing. The operation does not choose a retention budget, prune messages, or modify the original request.

The supplied WebSocket executor can reuse a compatible append baseline for the compaction request. On completion the protocol supplies no continuation checkpoint, clearing the old baseline so the next generation sends the newly installed window in full. Validation occurs before transport completion is acknowledged. There is no operation-level retry or fallback to `/responses/compact`; existing safe transport fallback may use SSE, with full history and no connection-local response ID.

Trigger support is separate from endpoint support. Only the OpenAI Responses route advertises it; Azure, xAI, Chat, and compatible Responses routes do not inherit it. Untyped calls still fail before sending: missing route capabilities return `UnsupportedOperation`, while unknown mechanism names and invalid inputs return `InvalidRequest`. Dynamic callers must narrow for the selected mechanism:

```ts
if (LLMClient.canCompact(request, { mechanism: "trigger" })) {
  const result = yield * LLMClient.compact(request, { mechanism: "trigger" })
}
```

This capability describes protocol implementation, **not universal availability on OpenAI API deployments**. The host application owns subscription/deployment eligibility, OAuth, endpoint selection, and deployment-specific headers. Local protocol/socket tests do not establish live provider support.

### Advanced: in-band compaction

`providerOptions.contextManagement` lets the provider decide when to compact during an ordinary `generate` or `stream` call. This is an advanced option for callers that own persistence and recovery: persist the complete assistant message, including its checkpoint, before continuing. Enabling the option does not provide durable checkpoint storage, interruption recovery, or model-switch policy. Keep the prior context until a successful checkpoint has been persisted.

Inside an `Effect.gen`, enable OpenAI compaction with typed provider options:

```ts
import { LLM, LLMClient, LLMRequest, Message } from "@opencode-ai/ai"
import { OpenAI } from "@opencode-ai/ai/providers"

const request = LLM.request({
  model: OpenAI.configure({ apiKey }).responses("gpt-5.3-codex"),
  messages,
  providerOptions: {
    contextManagement: [{ type: "compaction", compactThreshold: 200_000 }],
  },
})
const response = yield * LLMClient.generate(request)
const next = LLMRequest.update(request, {
  messages: [...request.messages, response.message, Message.user("Continue")],
})
```

`store: false` remains the default. Keep the entire `response.message`, not just `response.text`. Compaction events become ordered `CompactionPart`s alongside text and reasoning. The conversation contains everything needed to continue; there is no separate replay object or hidden provider transcript.

A compaction part has `provider` and exactly one representation: `encrypted` for Responses, or `text` for Anthropic. Responses also preserves the optional checkpoint `id`. These fields survive message serialization without becoming visible assistant text. Sending a checkpoint to another provider or an incompatible API fails rather than silently losing context.

```ts
import { CompactionPart, ProviderID } from "@opencode-ai/ai"

CompactionPart.make({ provider: ProviderID.make("openai"), id: "cmp_123", encrypted: "..." })
CompactionPart.make({ provider: ProviderID.make("anthropic"), text: "Summary of the conversation..." })
```

For Anthropic, use:

```ts
providerOptions: {
  contextManagement: {
    edits: [{
      type: "compact_20260112",
      trigger: { type: "input_tokens", value: 150_000 },
      pauseAfterCompaction: true,
      instructions: "Summarize the task and decisions. Do not call tools while summarizing.",
    }],
  },
}
```

- The trigger is optional (provider default: 150,000 tokens), with a minimum of 50,000.
- Custom instructions replace Anthropic's default summarization instructions.
- The route adds `compact-2026-01-12` to existing beta headers, including when replaying a checkpoint without enabling new compactions.
- A pause is exposed as `response.finishReason.raw === "compaction"`. It occurs only if the threshold triggers compaction: `pauseAfterCompaction` does not mean "compact now". The caller explicitly issues the next request; the package never automatically resumes.
- Anthropic can return a compaction block with `content: null` when summarization fails. This becomes a compaction part with `text: null`, which is **not** a successful replacement for prior history. The package never prunes history automatically.
- `Usage` totals include all reported Anthropic `usage.iterations`, including compaction. `contextTokens` separately reports the final message iteration's inclusive input size, when available. A compaction-only pause does not report a post-compaction context size. Raw iteration usage remains in `providerMetadata`.

### Ownership and verification

The AI package transports options and typed conversation parts. It does not schedule compaction, persist Session checkpoints, select history, switch providers, or replace Core's existing local compaction policy. Native compaction is not enabled for OpenCode Sessions by this feature; Session integration must persist these parts before enabling it. The AI SDK bridge rejects native compaction parts rather than dropping them. Provider-executed tool APIs and persistence changes are a separate follow-up.

Tests cover serialized round trips, real local HTTP plus a tool loop, WebSocket recovery, provider errors, malformed blocks, and usage accounting. Live provider tests are gated by `RECORD=true` and the relevant API keys:

```sh
# Run from packages/ai. Only records the selected new cassette group.
RECORD=true RECORDED_PREFIX=openai-compaction bun test test/provider/compaction.recorded.test.ts
RECORD=true RECORDED_PREFIX=xai-compaction bun test test/provider/compaction.recorded.test.ts
RECORD=true RECORDED_PREFIX=anthropic-compaction bun test test/provider/compaction.recorded.test.ts
```

Provider references: [OpenAI](https://developers.openai.com/api/docs/guides/compaction), [Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses#server-side-compaction), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/compaction), [xAI](https://docs.x.ai/developers/advanced-api-usage/context-compaction).

## Caching

Prompt caching is **on by default**. Every `LLMRequest` resolves to `cache: "auto"` unless the caller opts out with `cache: "none"`. Each protocol translates `CacheHint`s to its wire format (`cache_control` on Anthropic, `cachePoint` on Bedrock; OpenAI and Gemini do implicit caching server-side and don't need inline markers — auto is a no-op there).

### Auto placement

`"auto"` places up to four breakpoints — the last tool definition, the first system part, the last system part when distinct, and the final message boundary. These expose successively larger reusable prefixes for tools, the base agent, project instructions, and the active conversation. The rolling final-message boundary advances on every request so recent conversation prefixes remain reusable during tool loops.

Tools precede every system and conversation block in the provider prefix, so tool definitions must remain byte-stable and deterministically ordered for downstream breakpoints to remain reusable.

Requests below a provider's minimum cacheable size simply do not produce a reusable cache entry.

### Opting out

```ts
LLM.request({
  model,
  system,
  prompt: "one-off question",
  cache: "none",
})
```

### Granular policy

```ts
cache: {
  tools?: boolean,
  system?: boolean,
  messages?: "latest-user-message" | "latest-assistant" | { tail: number },
  ttlSeconds?: number,         // ≥ 3600 → 1h on Anthropic/Bedrock; else 5m
}
```

### Manual hints

Inline `CacheHint` on any text / system / tool / tool-result part overrides automatic placement. The auto policy preserves manual hints, counts them against Anthropic and Bedrock's four-breakpoint limit, and only fills the remaining slots.

```ts
LLM.request({
  model,
  system: [
    { type: "text", text: "stable system prompt", cache: { type: "ephemeral" } },
  ],
  ...
})
```

### Provider behavior table

| Protocol                | `cache: "auto"`                                                           |
| ----------------------- | ------------------------------------------------------------------------- |
| Anthropic Messages      | emits up to 4 `cache_control` markers (4-breakpoint cap enforced)         |
| Bedrock Converse        | emits up to 4 `cachePoint` blocks (4-breakpoint cap enforced)             |
| OpenRouter              | emits up to 4 `cache_control` markers                                     |
| OpenAI Chat / Responses | no-op (implicit caching above 1024 tokens)                                |
| Gemini                  | no-op (implicit caching on 2.5+; explicit `CachedContent` is out-of-band) |

Normalized cache usage is read back into `response.usage.cacheReadInputTokens` and `cacheWriteInputTokens` across every provider.

## Providers

Provider facades configure endpoint/auth/deployment details first, then expose model selectors that take only a model or deployment id. The selected model carries the executable route value used at runtime.

```ts
import { OpenAI, CloudflareAIGateway } from "@opencode-ai/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).responses("gpt-4o-mini")
const gateway = CloudflareAIGateway.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN,
}).model("workers-ai/@cf/meta/llama-3.1-8b-instruct")
```

Included providers: OpenAI, Anthropic, Google (Gemini), Google Vertex Gemini and Anthropic, Amazon Bedrock, Azure OpenAI, Cloudflare AI Gateway, Cloudflare Workers AI, GitHub Copilot, OpenRouter, xAI, Z.ai, plus generic OpenAI-compatible Chat and Responses entrypoints and an Anthropic Messages-compatible entrypoint.

### Package-like entrypoints

Native catalog integrations load provider behavior through package-like entrypoints. These are export paths from the same `@opencode-ai/ai` npm package, not independently published packages. Each entrypoint exports the same `model(modelID, settings)` contract, and `settings` contains serializable provider configuration plus common `headers` and `body` overlays.

```ts
import { model } from "@opencode-ai/ai/providers/openai/responses"

const selected = model("gpt-5", {
  apiKey: process.env.OPENAI_API_KEY,
  headers: { "x-application": "opencode" },
})
```

OpenAI Chat and OpenAI Responses are separate semantic entrypoints:

- `@opencode-ai/ai/providers/openai/chat`
- `@opencode-ai/ai/providers/openai/responses`
- `@opencode-ai/ai/providers/openai-compatible/responses`
- `@opencode-ai/ai/providers/anthropic-compatible`
- `@opencode-ai/ai/providers/google-vertex/gemini`
- `@opencode-ai/ai/providers/google-vertex/chat`
- `@opencode-ai/ai/providers/google-vertex/responses`
- `@opencode-ai/ai/providers/google-vertex/messages`

OpenAI Responses has one semantic route and uses HTTP by default. Advanced callers may supply a per-call WebSocket channel executor through `StreamOptions`; transport policy does not change provider settings, model identity, or route identity. The provider-neutral Open Responses implementation owns the reusable WebSocket request and event contract, while each provider opts in with its own handshake and connection policy. Azure follows the same Chat/Responses split at `providers/azure/chat` and `providers/azure/responses`. Generic OpenAI-compatible Chat remains at `providers/openai-compatible`; the Responses adapter at `providers/openai-compatible/responses` uses the provider-neutral Open Responses protocol. OpenAI Responses extends that baseline with OpenAI tools, event variants, metadata, and defaults. Generic Anthropic Messages-compatible providers use `providers/anthropic-compatible`, which the named Anthropic provider composes. Google Gemini and Amazon Bedrock expose their single native API through their existing provider paths.

Vertex Gemini, Vertex Chat, Vertex Responses, and Vertex Messages are separate API entrypoints. All accept `project`, `location`, and an optional `accessToken`; when no explicit token or auth override is supplied they lazily use Google Application Default Credentials. Vertex Gemini instead selects express mode when `apiKey` or `GOOGLE_VERTEX_API_KEY` is present. Vertex Chat targets MaaS models through the OpenAI-compatible Chat Completions endpoint, while Vertex Responses targets Grok models and defaults `store` to `false` as required by Vertex. `providers/google-vertex` remains the default alias for `providers/google-vertex/gemini`.

Tuned Vertex Gemini deployments use model ids shaped like `endpoints/1234567890` and require OAuth or ADC; Vertex express-mode API keys support publisher models only.

```ts
import { model } from "@opencode-ai/ai/providers/google-vertex/gemini"

model("gemini-3.5-flash", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode-ai/ai/providers/google-vertex/chat"

model("deepseek-ai/deepseek-v3.2-maas", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode-ai/ai/providers/google-vertex/responses"

model("xai/grok-4.20-reasoning", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode-ai/ai/providers/google-vertex/messages"

model("claude-sonnet-4-6", { project: "my-project", location: "global" })
```

Provider facades such as `OpenAI.configure(...).responses(...)` remain the direct application API. Package-like entrypoints are the self-similar loading contract used when a catalog selects behavior by export path.

Other provider exports listed above remain direct facades until they explicitly implement the package-like contract. Exporting a provider facade does not implicitly make it a catalog-loadable provider package.

## Provider options & HTTP overlays

Request options in order of stability:

1. **`generation`** — portable knobs (`maxTokens`, `temperature`, `topP`, `topK`, penalties, seed, stop).
2. **`promptCacheKey`** — stable cache affinity lowered by every protocol that supports it.
3. **`providerOptions: { ... }`** — flat options inferred from the selected model (OpenAI `store`, Anthropic `thinking`, Gemini `thinkingConfig`, OpenRouter routing).
4. **`http: { body, headers, query }`** — last-resort serializable overlays merged into the final HTTP request. Reach for this only when a stable typed path doesn't yet exist.

Route/provider defaults are overridden by request-level values for each axis.

The selected model supplies the provider-specific option type, so per-request overrides stay flat while the canonical runtime request remains provider-neutral:

```ts
LLM.request({
  model,
  prompt,
  providerOptions: {
    reasoningEffort: "low",
  },
})
```

## Routes

Adding a new model or deployment is usually 5-15 lines using `Route.make({ protocol, endpoint, auth, framing, ... })`. The route owns endpoint/auth/framing and the protocol owns body construction plus stream parsing. Transports are reusable IO templates that receive route endpoint/auth at compile time. Capability/catalog metadata lives outside this low-level package; unsupported request shapes fail during protocol lowering. See `AGENTS.md` for the architectural detail.

## Effect

This package is built on Effect. Public methods return `Effect` or `Stream`; provide `LLMClient.layer` for LLM dispatch and `ImageClient.layer` for image dispatch, then import the provider/protocol modules for the routes you use. The example at `example/tutorial.ts` is a runnable walkthrough.

## See also

- `AGENTS.md` — architecture, route construction, contributor guide
- `example/tutorial.ts` — runnable end-to-end walkthrough
- `test/provider/*.test.ts` — fixture-first protocol tests; `*.recorded.test.ts` files cover live cassettes
