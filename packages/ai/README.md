# @opencode/ai

Schema-first APIs for text, images, video, speech, and transcription, built with Effect.

```ts
import { Effect } from "effect"
import { AIClient, LLM } from "@opencode/ai"
import { OpenAI } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY })

const request = LLM.request({
  model: openai.responses("gpt-4o-mini"), // `.chat(...)` selects the Chat Completions API instead
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 40 },
})

const program = Effect.gen(function* () {
  const response = yield* LLM.generate(request)
  console.log(response.text)
})

// Every modality client plus the HTTP request executor; `AIClient.layerWith(executor)` swaps the executor.
await Effect.runPromise(program.pipe(Effect.provide(AIClient.layer)))
```

Run `LLM.stream(request)` instead of `generate` when you want incremental `LLMEvent`s. The event stream is provider-neutral — same shape across OpenAI Chat, OpenAI Responses,
Anthropic Messages, Gemini, Bedrock Converse, and any OpenAI-compatible deployment.

The same configured facade names image, video, speech, and transcription models. `Image.generate` resolves the
provider's image route from the model and returns `Media.Asset`s with lazily decoded bytes:

```ts
import { NodeFileSystem } from "@effect/platform-node"
import { Image, Media } from "@opencode/ai"

const image = Effect.gen(function* () {
  const response = yield* Image.generate({
    model: openai.image("gpt-image-2"),
    prompt: "A robot tending a rooftop garden",
    size: "1024x1024",
    providerOptions: { quality: "high" }, // typed per image model
  })
  yield* Media.write(response.image, "./garden.png")
})

// `Media.file` / `Media.write` use the Effect `FileSystem` service; provide your platform's layer.
await Effect.runPromise(image.pipe(Effect.provide(AIClient.layer), Effect.provide(NodeFileSystem.layer)))
```

Advanced: each client also has its own `layer`, which requires `RequestExecutor.Service`. Compose client layers with
`Layer.provideMerge`, not `Layer.provide`: `asset.bytes()`, `Media.write`, and Gemini's `media` output parts need the
executor too, and hiding it fails type-checking with `RequestExecutorService` left in the requirements.

To share a policy such as logging across every client, wrap the executor once with `RequestExecutor.middleware`:

```ts
import { RequestExecutor } from "@opencode/ai/route"

const logged = RequestExecutor.middleware((request, next) =>
  Effect.log(`${request.method} ${request.url}`).pipe(Effect.andThen(next(request))),
)

const everything = AIClient.layerWith(logged) // or AI.make({ layer: logged })
```

Prefer promises? `@opencode/ai/promise` exposes the same LLM and media APIs over one managed runtime, plus asset
helpers; `ai.file` and `ai.write` load `node:fs/promises` on first use, so no Effect `FileSystem` is needed:

```ts
import { AI } from "@opencode/ai/promise"

const ai = AI.make()
const request = ai.llm.request({ model: openai.responses("gpt-4o-mini"), prompt: "Say hello." })
const text = await ai.llm.generate(request)
const generated = await ai.image.generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })
await ai.write(generated.image, "./lighthouse.png") // also ai.file(path), ai.bytes(asset), ai.base64(asset), ai.materialize(asset)
for await (const event of ai.llm.stream(request)) {
  // LLMEvent
}
await ai.dispose()
```

## Experimental evaluation

Evaluation models compare shared state with typed choice, score, and boolean questions. The API is
isolated under an experimental entrypoint and provider namespace while the contract evolves:

```ts
import { Effect } from "effect"
import { Evaluation, EvaluationClient } from "@opencode/ai/experimental"
import { TypeSafeAI } from "@opencode/ai/providers"

const model = TypeSafeAI.configure().experimental.evaluation("jev-latest")

const program = Evaluation.run({
  model,
  state: "I was charged twice. Please refund the duplicate payment.",
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this?",
      criteria: ["Can wait", "Needs prompt attention", "Blocking revenue"],
    },
    refund: { type: "boolean", instructions: "Is the customer asking for a refund?" },
  },
})

const response = await Effect.runPromise(program.pipe(Effect.provide(EvaluationClient.fetchLayer)))

console.log(response.answers.department.choice)
console.log(response.answers.refund.probability)
```

`TypeSafeAI` reads `TYPESAFE_API_KEY`. `OpenCodeZen` exposes the same selector and reads
`OPENCODE_API_KEY`. OpenRouter and Vercel AI Gateway use the same provider shape:

```ts
import { OpenRouter, VercelAIGateway } from "@opencode/ai/providers"

OpenRouter.configure().experimental.evaluation("typesafe/jev-1.13")
VercelAIGateway.configure().experimental.evaluation("typesafe-ai/jev")
```

OpenRouter reads `OPENROUTER_API_KEY`. Vercel reads `AI_GATEWAY_API_KEY`, then `VERCEL_OIDC_TOKEN`.
The common API uses `boolean`; System One routes lower it to native `noul`.
Choice and score confidence plus score legends remain available in provider metadata, and the
provider's rounded probabilities are returned unchanged.

## Alibaba Cloud Model Studio

`Alibaba` provides standard Model Studio inference. Configure a region explicitly, then select
Chat Completions (`.model` or `.chat`), Anthropic-compatible Messages (`.messages`), or OpenAI-compatible
Responses (`.responses`). These routes use HTTP/SSE.

```ts
import { LLM } from "@opencode/ai"
import { Alibaba } from "@opencode/ai/providers"

const alibaba = Alibaba.configure({
  region: "ap-southeast-1", // Singapore
  apiKey: process.env.DASHSCOPE_API_KEY,
  // workspaceID: "llm-your-workspace", // use a workspace-dedicated endpoint
})

const request = LLM.request({
  model: alibaba.model("qwen3.8-max"),
  prompt: "Explain this design.",
  providerOptions: { reasoningEffort: "medium" },
})
```

### Regions and credentials

| Region              | `region`         | Shared host when `workspaceID` is omitted |
| ------------------- | ---------------- | ----------------------------------------- |
| Singapore           | `ap-southeast-1` | `dashscope-intl.aliyuncs.com`             |
| China (Beijing)     | `cn-beijing`     | `dashscope.aliyuncs.com`                  |
| China (Hong Kong)   | `cn-hongkong`    | `cn-hongkong.dashscope.aliyuncs.com`      |
| US (Virginia)       | `us-east-1`      | `dashscope-us.aliyuncs.com`               |
| Germany (Frankfurt) | `eu-central-1`   | Supply `workspaceID` or `baseURL`         |
| Japan (Tokyo)       | `ap-northeast-1` | Supply `workspaceID` or `baseURL`         |

With `workspaceID`, the host is `{workspaceID}.{region}.maas.aliyuncs.com`. A complete `baseURL`
overrides regional setup, including the API prefix: `/compatible-mode/v1` for Chat/Responses,
or `/apps/anthropic/v1` for Messages. The selector appends its operation path.

Keys and model availability are region-specific. Auth resolves from explicit `auth` or `apiKey`,
then `DASHSCOPE_API_KEY`, then `ALIBABA_API_KEY`.

The access region and inference scope differ: Virginia's `-us` model IDs request US-only inference;
some regions select scope through their workspace. Model IDs pass through unchanged.
Alibaba's [regional guide](https://www.alibabacloud.com/help/en/model-studio/regions) and
[base URL table](https://www.alibabacloud.com/help/en/model-studio/base-url) disagree about Virginia's
shared host; the entry above follows the base URL table. Dedicated hosts can be copied from the console.

### Native options

- **Chat:** `reasoningEffort` → `reasoning_effort`, `enableThinking` → `enable_thinking`,
  `thinkingBudget` → `thinking_budget`, and `preserveThinking` → `preserve_thinking`.
  Replay complete `response.message` values to retain `reasoning_content` separately from answer text.
  Qwen 3.8 defaults to preserving thinking; older models have different defaults.
  Additional options include `toolStream`, `parallelToolCalls`, `repetitionPenalty`, `responseFormat`,
  `enableSearch`, and native `searchOptions`. `generation.topK` lowers to `top_k`.
  `clearThinking` is a hosted GLM control, and `thinking.type` is available for hosted MiniMax models.
- **Messages:** `effort` → `output_config.effort`. `thinking.type` accepts enabled/disabled with an
  optional `budgetTokens` (or native `budget_tokens`). `outputConfig.format` accepts a JSON schema.
  Model Studio's empty thinking signatures are accepted; supplied signatures are replayed unchanged.
- **Responses:** `reasoningEffort` → `reasoning.effort`, plus `enableThinking`, `store`,
  `previousResponseId`, and `conversation`. Omitted `store` retains the API's default (`true`);
  set it to `false` for client-managed history. `previousResponseId` requires a stored response.
  Hosted tools are `Alibaba.webSearch()`, `Alibaba.webExtractor()`, and `Alibaba.codeInterpreter()`.
  Web extraction is used together with web search. Hosted calls/results carry `providerExecuted: true`.

Omitted options preserve provider defaults. Effort values pass through unchanged and accept future
strings. Qwen 3.8 Chat rejects requests combining a thinking budget with effort.

Package entrypoints are `@opencode/ai/providers/alibaba`, `alibaba/chat`, `alibaba/messages`,
and `alibaba/responses`. Live recordings cover all three APIs in Singapore; regional URL construction
is unit-tested for all six regions.

## Z.AI

`ZAI` uses the standard API. Chat Completions is the default language-model API;
the existing `.image(...)` selector provides image generation.

```ts
import { LLM } from "@opencode/ai"
import { ZAI, ZAICodingPlan } from "@opencode/ai/providers"

const zai = ZAI.configure({ apiKey: process.env.ZAI_API_KEY })
const request = LLM.request({
  model: zai.model("glm-5.3"), // also zai.chat("glm-5.3")
  prompt: "Explain this design.",
  providerOptions: {
    reasoningEffort: "high",
    thinking: { type: "enabled", clear_thinking: false },
  },
})

const coding = ZAICodingPlan.configure({ apiKey: process.env.ZAI_API_KEY })
const messages = LLM.request({
  model: coding.messages("glm-5.3"),
  prompt: "Explain this design.",
  providerOptions: { effort: "high" },
})
```

The products have distinct provider identities and endpoints:

| Provider                            | Selector                    | Default base URL                      |
| ----------------------------------- | --------------------------- | ------------------------------------- |
| `ZAI` (`zai`)                       | `.model`, `.chat`, `.image` | `https://api.z.ai/api/paas/v4`        |
| `ZAICodingPlan` (`zai-coding-plan`) | `.model`, `.chat`           | `https://api.z.ai/api/coding/paas/v4` |
| `ZAICodingPlan`                     | `.messages`                 | `https://api.z.ai/api/anthropic/v1`   |
| `ZAICodingPlan`                     | `.responses`                | `https://api.z.ai/api/v1`             |

Both read `ZAI_API_KEY` when `apiKey` is omitted and support an explicit `auth` override.
Coding Plan requires an active subscription. `baseURL` overrides the selected API's
complete base, including its version prefix. Language-model routes use HTTP/SSE.

Options retain the selected API's native semantics:

- Chat `reasoningEffort` lowers to `reasoning_effort`; Responses lowers it to `reasoning.effort`.
  Messages `effort` lowers to `output_config.effort`. Omission preserves provider defaults.
- Chat `thinking` passes `type` and `clear_thinking` through unchanged. Set
  `clear_thinking: false` and replay complete `response.message` values to preserve reasoning
  across user messages and tool loops. The standard API defaults to clearing historical thinking;
  Coding Plan documents preservation by default.
- Messages accepts `thinking: { type: "enabled" | "adaptive" | "disabled" }` without requiring
  an Anthropic token budget. Coding Plan documents a disabled toggle as low-effort thinking
  for GLM-5.3, with explicit effort taking precedence.
- Chat also offers `toolStream`, `doSample`, `responseFormat`, `requestID`, and `userID`.
  Tool-argument streaming is enabled when tools are present on GLM-4.6/4.7/5.x;
  `toolStream: false` explicitly disables it. Older model families omit the opt-in.
- Effort and thinking values remain forward-compatible strings. Their meaning is model-specific:
  GLM-5.3 accepts `low`, `high`, and `max` effort and rejects disabled thinking with HTTP 400;
  the direct GLM-5.2 recordings returned reasoning even with `none` and `minimal` effort,
  whereas explicit `thinking.type: "disabled"` disabled it on GLM-5.2 and GLM-4.7.

Standard API recordings cover GLM-5.3 efforts and a full preserved-reasoning tool loop with
a subsequent user follow-up, GLM-5.2 efforts, older-model thinking toggles, GLM-4.5 tool calls,
GLM-5.3-Flash image input, and JSON output. Coding Plan has unit coverage for routing,
request options, and reasoning replay; successful live recordings are pending.

Package entrypoints are `@opencode/ai/providers/zai`, `zai/chat`, `zai-coding-plan`,
`zai-coding-plan/chat`, `zai-coding-plan/messages`, and `zai-coding-plan/responses`.

## Moonshot

Moonshot defaults to Chat Completions, with Messages and Responses selectors for Kimi K3:

```ts
import { LLM } from "@opencode/ai"
import { Moonshot } from "@opencode/ai/providers"

const moonshot = Moonshot.configure({ apiKey: process.env.MOONSHOT_API_KEY })

const request = LLM.request({
  model: moonshot.model("kimi-k3"), // also moonshot.chat("kimi-k3")
  prompt: "Explain the tradeoffs in this design.",
  providerOptions: { reasoningEffort: "high" },
})

const messages = LLM.request({
  model: moonshot.messages("kimi-k3"),
  prompt: "Explain the tradeoffs in this design.",
  providerOptions: { effort: "high" },
})

const responses = LLM.request({
  model: moonshot.responses("kimi-k3"),
  prompt: "Explain the tradeoffs in this design.",
  providerOptions: { reasoningEffort: "high" },
})
```

When `apiKey` is omitted, authentication reads `MOONSHOT_API_KEY`, then `MOONSHOTAI_API_KEY`.
Chat and Responses use `https://api.moonshot.ai/v1`; Messages uses
`https://api.moonshot.ai/anthropic/v1`. `baseURL` overrides the selected API's complete base,
including the version prefix, for regional endpoints or gateways. Each endpoint requires its own valid credentials.
All three routes use HTTP/SSE.

Reasoning options stay native to the selected API and model:

| Model/API                   | Provider options                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------- |
| K3 Chat / Responses         | `reasoningEffort: "low" \| "high" \| "max"`; default is `max`                           |
| K3 Messages                 | `effort: "low" \| "high" \| "max"`; default is `max`                                    |
| K2.6 Chat                   | `thinking: { type: "enabled" \| "disabled", keep?: "all" \| null }`; default is enabled |
| K2.7 Code / high-speed Chat | Omit `thinking` to use always-on, preserved reasoning                                   |

Omitting options preserves the model's defaults. K3 uses effort rather than the K2.x `thinking`
parameter. Known effort values have autocomplete while future strings remain accepted.
For K2.6, `thinking.keep: "all"` enables preservation of reasoning across user messages.
K3 and both K2.7 Code variants always preserve reasoning. Continue with the returned
`response.message` and matching tool results so reasoning content and any Messages signatures are retained.
Leave sampling options such as `temperature` unset to use these models' fixed defaults.

The recorded suite covers all three K3 APIs, default and explicit efforts, K2.6 thinking modes,
both K2.7 Code variants, generated tool loops with a subsequent user follow-up, required/disabled
tool choice, image-byte input, and native structured output through `http.body` overlays.
K3 Chat and Messages accept required and disabled tool choice. Responses supports automatic tool
choice only; explicit `required` and `none` produce a provider `InvalidRequest` error, also covered by recordings.
The provider targets the Moonshot Open Platform; Kimi Code is a separate product and endpoint.

Package entrypoints are `@opencode/ai/providers/moonshot`, `moonshot/chat`, `moonshot/messages`,
and `moonshot/responses`; each exports `model(modelID, settings)`.

## MiniMax

MiniMax defaults to its Messages API and reads `MINIMAX_API_KEY` when `apiKey` is omitted:

```ts
import { Effect } from "effect"
import { AIClient, LLM } from "@opencode/ai"
import { MiniMax } from "@opencode/ai/providers"

const minimax = MiniMax.configure({ apiKey: process.env.MINIMAX_API_KEY })
const request = LLM.request({
  model: minimax.model("MiniMax-M3"), // also minimax.messages("MiniMax-M3")
  prompt: "What is 173 multiplied by 219?",
  providerOptions: { thinking: { type: "adaptive" } },
  generation: { maxTokens: 1536 },
})

const response = await Effect.runPromise(LLM.generate(request).pipe(Effect.provide(AIClient.layer)))
console.log(response.text)
```

Select `minimax.chat("MiniMax-M3")` or `minimax.responses("MiniMax-M3")` for MiniMax's native Chat Completions
and Responses APIs. The matching package entrypoints are `@opencode/ai/providers/minimax/messages`,
`@opencode/ai/providers/minimax/chat`, and `@opencode/ai/providers/minimax/responses`.

- **Messages:** M3 thinking defaults off. Set `thinking: { type: "adaptive" }` to enable it or
  `thinking: { type: "disabled" }` to disable it.
- **Chat:** M3 thinking defaults on and uses the same `thinking` control. The provider enables `reasoning_split`
  by default so reasoning is separate from answer text; `reasoningSplit: false` selects native `<think>`-tagged text.
- **Responses:** M3 reasoning defaults off. `reasoningEffort: "none"` disables it; `"minimal"`, `"low"`,
  `"medium"`, and `"high"` enable reasoning without changing its depth.

M2.x models always think, even when a disabling option is supplied. For tool continuations, retain the complete
`response.message` in history before adding `Message.tool(...)` results; this preserves reasoning and any signatures.

The default API bases are `https://api.minimax.io/anthropic/v1` for Messages and `https://api.minimax.io/v1` for
Chat and Responses. `configure({ baseURL })` replaces the selected API's base, including its version prefix.

## Meta

Use Meta's direct [Model API](https://dev.meta.ai/docs/overview) with `META_API_KEY`:

```ts
import { Meta } from "@opencode/ai/providers"

const meta = Meta.configure() // or Meta.configure({ apiKey })
const request = LLM.request({
  model: meta.responses("muse-spark-1.3"), // meta.model(...) also selects Responses
  prompt: "What is 173 multiplied by 219? Reply with the integer.",
  providerOptions: { reasoningEffort: "low" },
  generation: { maxTokens: 1024 },
})
```

`meta.chat("muse-spark-1.3")` selects Chat Completions; `meta.messages("muse-spark-1.3")` selects
the Anthropic-compatible Messages API. All use `https://api.meta.ai/v1`. The package entrypoints
`@opencode/ai/providers/meta/responses`, `meta/chat`, and `meta/messages` expose `model(modelID, settings)`.

[Muse Spark](https://dev.meta.ai/docs/models) supports `minimal`, `low`, `medium`, `high`, and
`xhigh` reasoning effort; standard-tier 1.3 also supports `max`. Omitting effort uses the model's
default. Muse Spark always reasons and rejects `none`. The output-token budget includes private reasoning.

Responses defaults to `store: false` and `include: ["reasoning.encrypted_content"]`. Preserve
`response.message` along with matching `Message.tool(...)` results in subsequent requests to replay
reasoning through tool loops. Optional `reasoningSummary: "auto"` requests a readable summary.
For server-managed history, override `store: true, include: []` and send the response ID through
`http: { body: { previous_response_id: responseID } }` with only the new input.
Chat Completions redacts private reasoning and cannot carry it between calls.
Responses and Chat support only `toolChoice: "auto"` (the default). Messages also accepts `"none"`;
its documented forced `"any"` choice currently returns HTTP 400. Messages defaults to adaptive thinking
with `display: "omitted"`, preserving encrypted `redacted_thinking` in `response.message`. Use
`providerOptions: { effort: "low" }` for depth or `thinking: { type: "enabled", budgetTokens: 1024 }`
for budget compatibility (with `generation.maxTokens > 1024`).

Add `tools: [Meta.webSearch()]` to a Spark Responses or Messages request for hosted web search.
Responses exposes hosted results and URL citations in text-part `providerMetadata.meta.annotations`.
To include search result lists, set `include: ["reasoning.encrypted_content", "web_search_call.results"]`.
Messages exposes hosted search calls; the recorded Messages API stream does not supply structured
citations or separate result blocks. Retain `response.message` for either API's continuation.

Use `Image.generate` for one-off generation or editing:

```ts
import { Image, Media } from "@opencode/ai"

const generation = Image.generate({
  model: meta.image("muse-image-1.0"),
  prompt: "A flat black square on a white background.",
  n: 1,
  providerOptions: { reasoningStrength: "low" },
})

const edit = Image.generate({
  model: meta.image("muse-image-1.0"),
  prompt: "Make the square purple.",
  images: [Media.bytes(imageBytes, "image/webp")],
  format: "png",
  providerOptions: { reasoningStrength: "low" },
})
```

The default image format is WEBP; `format` also accepts PNG/JPEG and `responseFormat: "url"`
returns a signed URL. `size` is an aspect-ratio hint. For conversational images, select
`meta.responses("muse-image-1.0")` with `tools: [Meta.imageGeneration({ reasoningStrength: "low" })]`.
Generated images are provider-executed tool results with file content. Retain `response.message` to
replay the signed image handle on the next request. Muse Image accepts only the `image_generation` tool.

Meta Responses is explicitly HTTP/SSE-only and does not use WebSockets, even when a caller supplies
`StreamOptions.webSocket`. The public `/v1/responses` endpoint rejects WebSocket upgrades with HTTP 405 (`Allow: POST`).

## Image generation

Use `Image.generate` with an image model for direct asset generation. `Image.request` mirrors `LLM.request`: the
model comes from the facade's `.image(...)` selector (mirroring `.responses(...)`), common fields
(`images`, `mask`, `n`, `size`, `aspectRatio`, `seed`, `format`) lower natively or fail typed, and
`providerOptions` is inferred from the selected model:

```ts
import { Image, Media } from "@opencode/ai"
import { OpenAI } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY })

const program = Effect.gen(function* () {
  const response = yield* Image.generate({
    model: openai.image("gpt-image-2"),
    prompt: "A robot tending a rooftop garden",
    n: 2,
    size: "1024x1024",
    format: "webp",
    providerOptions: {
      quality: "high", // inferred from the OpenAI image model
      future_option: true, // unknown native options pass through unchanged
    },
  })

  return response.images // Media.Asset[] with owned bytes or a provider URL
})
```

Common fields are portable in shape, not in support. Unsupported fields fail with a typed `AIError` before any network
call rather than being dropped, so check this table before swapping only the `model`:

| Provider              | `n` | `size`    | `aspectRatio` | `seed` | `format` | `images`                  | `mask`              |
| --------------------- | --- | --------- | ------------- | ------ | -------- | ------------------------- | ------------------- |
| OpenAI                | ✓¹  | ✓         | ✗             | ✗      | ✓        | ✓                         | ✓                   |
| Google (Gemini)       | 1   | ✗         | ✓             | ✓      | ✗        | ✓ (no public URLs)        | ✗                   |
| xAI                   | ✓   | ✗         | ✓             | ✗      | ✗        | ✓                         | ✗                   |
| Z.ai                  | ✗   | ✓         | ✗             | ✗      | ✗        | ✗                         | ✗                   |
| Meta                  | ✓   | ✓ (hint)  | ✗             | ✗      | ✓        | ✓                         | ✗                   |
| Black Forest Labs     | 1   | per model | per model     | ✓      | ✓        | per model (1–8)           | `flux-pro-1.0-fill` |
| fal                   | ✓   | per model | per model     | ✓      | ✓        | 1 (several on `/edit`)    | ✓                   |
| Replicate             | ✗   | ✗         | ✗             | ✗      | ✗        | ✗ (use `providerOptions`) | ✗                   |
| Stability `image`     | 1   | ✗         | ✓             | ✓      | ✓        | 1 (not on `core`)         | ✗                   |
| Stability `upscale()` | ✗   | ✗         | ✗             | ✓      | ✓        | exactly 1 (required)      | ✗                   |

✓ lowers natively; ✗ fails whenever the field is set (including `n: 1`); `1` means `n > 1` fails. ¹ `Image.stream` on OpenAI generates one image. fal
rejects `size` and `aspectRatio` together; which one a fal or BFL model takes depends on the model.

`Media.Asset` is the one asset type shared by image requests, image responses, LLM messages, and tool results.
`asset.source` is the serializable `Media.Source` (`bytes`, `base64`, `url`, or `ref`); `asset.bytes()`,
`asset.base64()`, and `asset.dataUrl()` decode or download lazily and cache; `asset.materialize()` pulls a `url`
asset into owned bytes before the provider URL expires. Construct assets with `Media.bytes`, `Media.base64`,
`Media.url`, `Media.ref(provider, id)`, `Media.fromDataUrl`, or `Media.file(path)`.

Pass ordered image inputs to the same method for editing, composition, or image-conditioned generation:

```ts
const composed = Effect.gen(function* () {
  const response = yield* Image.generate({
    model,
    prompt: "Combine these product photos into one studio scene",
    images: [
      Media.bytes(firstBytes, "image/png"),
      Media.url("https://example.com/second.webp"),
      Media.ref("openai", "file_123"),
    ],
    providerOptions,
    http,
  })
  return response.images
})
```

`Media.ref(provider, id)` represents provider file handles such as OpenAI file IDs or Gemini Files URIs; routes
only forward refs that belong to their own provider (OpenAI, xAI, and Gemini images accept them). No shipped route
returns a ref yet, and `asset.bytes()` / `materialize()` on a ref fail by design. Raw strings are not accepted as
image inputs, avoiding ambiguity between base64, URLs, and provider IDs. Empty or omitted `images` uses text-to-image generation; a
non-empty array selects the provider's edit behavior (see the table above for routes that limit the count). OpenAI
uses multipart for byte/data-URL edits and its JSON reference body for URL or file-ID edits. The common `mask`
field selects inpainting; routes that cannot honor it fail with `UnsupportedOperation`:

```ts
const inpainted = Image.generate({
  model: openai.image("gpt-image-2"),
  prompt,
  images: [Media.bytes(sourceBytes, "image/png")],
  mask: Media.bytes(maskBytes, "image/png"),
})
```

On multipart requests, `http.body` can override option fields but not structural `model`, `prompt`, `image[]`,
or `mask` fields, and the transport owns the multipart `Content-Type` boundary. For JSON requests, `http.body`
remains the final raw-native overlay. Gemini does not fetch public HTTP URLs, and hosted Z.ai image generation does
not accept image inputs. These cases fail with a typed `AIError` before network I/O.

Provider-native image options belong to each request. Raw `http.body` fields have final precedence over them:

```ts
const medium = Image.generate({
  model: openai.image("gpt-image-2"),
  prompt,
  providerOptions: { quality: "medium" },
  http,
})
```

xAI image models use the same request API with xAI-native controls:

```ts
import { XAI } from "@opencode/ai/providers"

const xai = Image.generate({
  model: XAI.configure({ apiKey }).image("any-model-id"),
  prompt,
  n: 2,
  aspectRatio: "16:9",
  providerOptions: {
    resolution: "1k",
    responseFormat: "b64_json",
    future_option: true,
  },
  http,
})
```

Google's current Gemini image models use the same direct API:

```ts
import { Google } from "@opencode/ai/providers"

const googleProgram = Effect.gen(function* () {
  const response = yield* Image.generate({
    model: Google.configure({ apiKey }).image("any-model-id"),
    prompt: "A robot tending a rooftop garden",
    aspectRatio: "16:9",
    seed: 42,
    providerOptions: {
      imageSize: "2K",
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
import { ZAI } from "@opencode/ai/providers"

const zai = Image.generate({
  model: ZAI.configure({ apiKey }).image("any-model-id"),
  prompt,
  providerOptions: {
    quality: "hd",
    userID: "user-123",
    future_option: true,
  },
  http,
})
```

Z.ai does not include trustworthy MIME metadata for output URLs, so generated images use
`application/octet-stream` until materialized. Output URLs expire after 30 days; call `asset.materialize()` and
persist the bytes promptly if they must remain available.

### Partial images

OpenAI's GPT image models stream previews. `Image.stream` sends `stream: true` with `partialImages` (0–3, default 2)
and emits `image-partial` events before each final `image`; `Image.generate` keeps the plain JSON request.
`dall-e-*` models do not stream and fail typed:

```ts
import { Stream } from "effect"
import { ImageEvent } from "@opencode/ai"

const previews = Image.stream({
  model: openai.image("gpt-image-2"),
  prompt: "A lighthouse at dusk",
  providerOptions: { partialImages: 2 },
}).pipe(Stream.runForEach((event) => (ImageEvent.is.imagePartial(event) ? showPreview(event.image) : Effect.void)))
```

The provider may send fewer previews than requested when the final image is ready first.

### Queued image providers

Black Forest Labs, fal, Replicate, and Stability's creative upscaler are submit-then-poll routes. `Image.generate`
and `Image.stream` poll for you (pass `{ poll }` to tune the interval and timeout); `Image.start` returns a
`Generation` whose `token` is serializable JSON for `Image.resume` in another process:

```ts
import { BlackForestLabs, Stability } from "@opencode/ai/providers"

const bfl = BlackForestLabs.configure({ apiKey: process.env.BFL_API_KEY })

const submit = Effect.gen(function* () {
  const generation = yield* Image.start({ model: bfl.image("flux-2-pro"), prompt, size: "1024x768" })
  persist({ provider: "black-forest-labs", modelID: "flux-2-pro", token: generation.token })
})

const finish = Effect.gen(function* () {
  const saved = load()
  const resumed = yield* Image.resume(bfl.image(saved.modelID), saved.token)
  return yield* resumed.await({ poll: { interval: "2 seconds" } })
})
```

The token carries no route identity, so persist the provider and model ID alongside it: `resume` needs the model.

- **Black Forest Labs** — results are downloaded before returning, because `result.sample` expires in 10 minutes.
- **Replicate** — inputs are model-defined, so only `prompt` lowers: sizing, count, seed, format, and files go in
  `providerOptions` under the model's names, with files as `Media.Asset` (data URLs up to 256 KB, larger by URL).
  Outputs are removed an hour after the prediction completes. `Prefer: wait=60` in `headers` or `http.headers` holds
  the submission open so a fast prediction costs one result read.
- **Stability** — `stability.image(id)` generates inline; `stability.upscale()` is the creative upscaler, queued:

```ts
const stability = Stability.configure({ apiKey: process.env.STABILITY_API_KEY })
const upscaled = Effect.gen(function* () {
  const small = yield* Media.file("./small.png")
  return yield* Image.generate(
    { model: stability.upscale(), prompt: "A lighthouse", images: [small] },
    { poll: { interval: "5 seconds" } },
  )
})
```

Imagen is not available: Google shut it down on the Gemini API, and Vertex discontinued the Imagen 4 models on
2026-06-30. `Google.image(...)` uses Gemini-native image models.

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

The hosted result is represented as a provider-executed tool call and tool result, and the generated image is also emitted as a first-class `media` `LLMEvent` (`response.message` then carries a `media` part). Gemini image-capable models emit the same `media` event for inline image output. Retaining `response.message` preserves the generated image for continuation on both routes.

## Video generation

Video mirrors `Image` with one difference: every provider is asynchronous, so the route is a submit-then-poll
`Generation`. Models come from `.video(...)` selectors on the `Google` (Veo), `XAI`, `Fal`, and `Runway` facades.
Common fields (`frames`, `references`, `video`, `durationSeconds`, `aspectRatio`, `resolution`, `audio`, `n`, `seed`,
`negativePrompt`) lower natively or fail with a typed `AIError` before any network call; provider-native controls live
under `providerOptions`, inferred from the selected model.

```ts
import { Video } from "@opencode/ai"
import { Google, Runway } from "@opencode/ai/providers"

const google = Google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })

// Simple: submit and wait.
const program = Effect.gen(function* () {
  const response = yield* Video.generate(
    {
      model: google.video("veo-3.1-generate-preview"),
      prompt: "Panning wide shot of a calico kitten sleeping in the sunshine",
      aspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      providerOptions: { personGeneration: "allow_adult" },
    },
    { poll: { interval: "10 seconds", timeout: "10 minutes" } },
  )
  // Veo serves files for two days behind the API key. The asset knows the deadline (`expiresAt`) and carries the
  // download credentials only on the live instance (`asset.headers`), never in `source` or JSON: materialize
  // before persisting, or the persisted URL cannot be fetched again.
  return yield* response.video.materialize()
})

// Explicit control: keep the handle, persist the token, resume elsewhere.
const controlled = Effect.gen(function* () {
  const generation = yield* Video.start({ model: google.video("veo-3.1-generate-preview"), prompt })
  generation.id // provider operation / task / request id
  generation.status // "queued" | "running" | "completed" | "failed" | "cancelled" | "expired"
  generation.token // route-owned JSON: `{ operation }`, `{ requestID }`, `{ taskID }`, or fal's follow-up URLs
  // The token carries no route identity: persist the provider and model ID alongside it, since `resume` needs the model.
  const saved = JSON.stringify(generation.token)

  const resumed = yield* Video.resume(google.video("veo-3.1-generate-preview"), JSON.parse(saved))
  return yield* resumed.await({ poll: { interval: "10 seconds" } })
})

// Progress as a stream: generation-queued | generation-progress | video | finish.
const events = Video.stream({ model: Runway.configure({ apiKey }).video("gen4.5"), prompt }, { poll })
```

Status polls, result fetches, cancels, and asset downloads all run through the same request executor with the route's
auth. `Generation.await` and `Generation.events` fail with a
`Timeout` reason when `poll.timeout` (default 10 minutes) elapses. Failed,
cancelled, and expired generations fail typed with the provider's terminal document on `reason.body`; moderation
outcomes (Veo `raiMediaFilteredReasons`, xAI `respect_moderation`, Runway `SAFETY.*` codes) surface as `notices` when
a video is still returned and as a `ContentPolicy` reason when nothing is.

Provider notes:

- **Google Veo** takes inline bytes only (materialize `url` assets first); `frames.last` requires `frames.first`;
  audio is always on, so `audio: false` fails typed; one video per request. Output URLs need the API key to
  download, which the returned asset holds transiently (see above).
- **xAI** sends a `video` input to `/videos/edits`, or `/videos/extensions` with `providerOptions.mode: "extend"`.
  `seed` and `negativePrompt` are not supported.
- **fal** endpoints are model-specific: `durationSeconds`, `references`, and `frames.last` fail typed and belong in
  `providerOptions` under the model's own names (`duration: "8s"`, `end_image_url`, …). Auth is
  `Authorization: Key <FAL_KEY>`.
- **Runway** expects pixel ratios in `aspectRatio` for most models (`"1280:720"`), pins `X-Runway-Version`, reports
  `usage: { type: "credits" }`, and its output URLs expire after 24–48 hours.

The promise client exposes the same surface: `ai.video.start(...)` resolves to a handle with `await`, `events`,
`result`, `refresh`, `cancel`, and `token`; `ai.video.generate`, `ai.video.resume(model, token)`, and
`ai.video.stream` mirror the Effect API. The handle's `status` and `progress` are a snapshot from when it was
created; `refresh()` resolves to a new handle.

```ts
import { ai } from "@opencode/ai/promise"

const generation = await ai.video.start({ model, prompt })
for await (const event of generation.events({ poll: { interval: 10_000 } })) console.log(event.type)
const video = await generation.result({ signal })
await ai.write(video.video, "./kite.mp4")
```

## Speech generation

Speech (text-to-speech) is one request whose response is parsed incrementally, so every route supports both
`Speech.generate` (the whole file) and `Speech.stream` (audio chunks as they arrive). Models come from `.speech(...)`
selectors on the `OpenAI`, `Google` (Gemini TTS), `ElevenLabs`, `Cartesia`, and `Deepgram` facades. Common fields
(`voice`, `format`, `speed`, `language`, `instructions`, `timestamps`) lower natively or fail with a typed `AIError`
before any network call; provider-native controls live under `providerOptions`, inferred from the selected model.

```ts
import { Media, Speech, SpeechClient, SpeechEvent } from "@opencode/ai"
import { ElevenLabs, OpenAI } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY })

// The whole file, written to disk.
const program = Effect.gen(function* () {
  const response = yield* Speech.generate({
    model: openai.speech("gpt-4o-mini-tts"),
    text: "Hello from OpenCode.",
    voice: "coral",
    format: "mp3",
    instructions: "Warm and unhurried.",
  })
  response.audio // Media.Asset with bytes; headerless PCM carries info.encoding / sampleRate / channels
  response.usage // undefined: OpenAI reports tokens only on SSE streams (Gemini: tokens; ElevenLabs: credits; Deepgram: characters)
  yield* Media.write(response.audio, "hello.mp3")
})

// Chunks as they arrive: audio-delta* (interleaved with timestamps) then one finish carrying the assembled asset.
const events = Speech.stream({
  model: ElevenLabs.configure({ apiKey }).speech("eleven_flash_v2_5"),
  text: "Hello from OpenCode.",
  voice: "JBFqnCBsd6RMkjVDRZzb",
  format: "pcm",
  timestamps: true,
}).pipe(
  Stream.tap((event) => {
    if (SpeechEvent.is.audioDelta(event)) return play(event.chunk)
    if (SpeechEvent.is.timestamps(event)) return highlight(event.items) // { text, startSeconds, endSeconds }[]
    return Effect.void
  }),
)
```

`voice` is the provider's own identifier — a name on OpenAI and Gemini (`"coral"`, `"Kore"`), a voice id on
ElevenLabs and Cartesia. `{ id }` selects an OpenAI custom voice (`{ id: "voice_1234" }`) and means the same as the
plain string elsewhere. There is no cross-provider voice catalog. `format` is the container-level word (`mp3`, `wav`,
`pcm`, `opus`, `aac`, `flac`); sample rates and bitrates live under `providerOptions`, and a value the route cannot
produce fails as `UnsupportedOperation`. Streams buffer every chunk so `finish` can carry the whole clip.

Provider notes:

- **OpenAI** streams over SSE (`stream_format: "sse"`), which is also the only place it reports token usage; `tts-1`
  and `tts-1-hd` do not support SSE and stream the raw audio body instead. `pcm` is 24 kHz 16-bit mono. `language`
  and `timestamps` are not supported.
- **Gemini TTS** returns raw 16-bit PCM only (`audio/L16;codec=pcm;rate=24000`), so any `format` other than `pcm`
  fails typed; wrap the samples yourself. Style is directed in the text, so `instructions` and `speed` fail typed.
  Only `gemini-3.1-flash-tts-preview` and later support streaming. Two-speaker audio goes through
  `providerOptions.speechConfig.multiSpeakerVoiceConfig`.
- **ElevenLabs** requires `voice` (the path voice id) and authenticates with `xi-api-key`. `format` maps to the
  `output_format` query parameter (`mp3_44100_128`, `pcm_24000`, `wav_24000`, `opus_48000_64`);
  `providerOptions.outputFormat` sets the exact string. WAV is only available from `generate`. `timestamps: true`
  selects the `with-timestamps` endpoints and yields character-level alignment. `instructions` is not supported.
- **Cartesia** requires `voice` and pins `Cartesia-Version`. `generate` defaults to MP3 from `/tts/bytes`; streams
  and `timestamps: true` (word-level) use `/tts/sse`, which only serves raw PCM. `providerOptions.sampleRate`,
  `bitRate`, and `encoding` complete `output_format`. No usage is reported.
- **Deepgram** Aura's voice is the model id (`aura-2-thalia-en`), so `voice` and `language` fail typed. `format`
  and `providerOptions` lower to query parameters (`encoding`, `container`, `sample_rate`, `bit_rate`); `pcm` is
  `linear16` without a container. Auth is `Authorization: Token <DEEPGRAM_API_KEY>`.

The promise client mirrors the Effect API; `ai.speech.stream` is an `AsyncIterable`.

```ts
import { ai } from "@opencode/ai/promise"

const response = await ai.speech.generate({ model, text: "Hello from OpenCode.", voice: "coral" })
await ai.write(response.audio, "hello.mp3")

for await (const event of ai.speech.stream({ model, text: "Hello from OpenCode.", voice: "coral" })) {
  if (event.type === "audio-delta") player.write(event.chunk)
}
```

## Transcription

Transcription (speech-to-text) is the one modality whose providers use every route kind: OpenAI and Gemini stream,
Deepgram answers inline, and AssemblyAI is queued. `Transcription.generate` and `Transcription.stream` work on all of
them; `Transcription.start` / `resume` return a `Generation` on queued routes and fail with `UnsupportedOperation`
elsewhere. Models come from `.transcription(...)` selectors on the `OpenAI`, `Google`, `Deepgram`, and `AssemblyAI`
facades. Common fields (`language`, `prompt`, `timestamps: "none" | "segment" | "word"`, `diarize`, `speakers`) lower
natively or fail with a typed `AIError` before any network call; a route may return more than asked.

```ts
import { Console, Effect, Stream } from "effect"
import { Media, Transcription, TranscriptionEvent } from "@opencode/ai"
import { AssemblyAI, Deepgram, OpenAI } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY })

const program = Effect.gen(function* () {
  const audio = yield* Media.file("./call.mp3")

  // Speaker-labelled segments; labels are provider-native strings ("A", "0", "spk:0").
  const response = yield* Transcription.generate({
    model: Deepgram.configure({ apiKey }).transcription("nova-3"),
    audio,
    diarize: true,
    timestamps: "word",
  })
  response.text // "Hello from OpenCode."
  response.segments // [{ text, startSeconds, endSeconds, speaker: "0" }]
  response.words // [{ text, startSeconds, endSeconds, speaker, confidence }]
  response.language // the provider's own value, lowercased ("en", "english", "en_us")

  // Text deltas as the model transcribes, then one finish carrying the whole transcript.
  yield* Transcription.stream({ model: openai.transcription("gpt-4o-mini-transcribe"), audio }).pipe(
    Stream.tap((event) => (TranscriptionEvent.is.textDelta(event) ? Console.log(event.delta) : Effect.void)),
    Stream.runDrain,
  )

  // Queued: persist the token with the provider and model ID (the token alone cannot pick the model), resume, and await.
  const model = AssemblyAI.configure({ apiKey }).transcription("universal-3-5-pro")
  const generation = yield* Transcription.start({ model, audio })
  const resumed = yield* Transcription.resume(model, JSON.parse(JSON.stringify(generation.token)))
  const transcript = yield* resumed.await({ poll: { interval: "3 seconds" } })
})
```

Inline routes emit only `finish` from `stream` (no faked deltas); queued routes emit `generation-queued` /
`generation-progress` before it.

Provider notes:

- **OpenAI** takes inline audio only; `diarize` needs `gpt-4o-transcribe-diarize`, timestamps need `whisper-1`, and `whisper-1` does not stream.
- **Gemini** needs a transcribe model (`gemini-3.5-transcribe`); `prompt` and `speakers` fail typed.
- **Deepgram** detects the language unless `language` is set; vocabulary goes in `providerOptions.keyterm`.
- **AssemblyAI** uploads inline audio before submitting and is the only route that accepts `speakers`.

The promise client mirrors the Effect API:

```ts
const audio = await ai.file("./call.mp3")
const text = (await ai.transcription.generate({ model, audio })).text
for await (const event of ai.transcription.stream({ model, audio })) if (event.type === "text-delta") write(event.delta)
const generation = await ai.transcription.start({ model: assemblyai, audio })
const transcript = await generation.await({ poll: { interval: 3_000 } })
```

## Public API

- **`LLM.request({...})`** — build a provider-neutral `LLMRequest`. Accepts ergonomic inputs (`system: string`, `prompt: string`) that normalize into the canonical Schema classes.
- **`LLM.generate` / `LLM.stream`** — re-exported from `LLMClient` for one-import use.
- **`Message.user(...)` / `Message.assistant(...)` / `Message.tool(...)`** — message constructors from the canonical schema model.
- **`LanguageModel.make(...)` / `ToolCallPart.make(...)` / `ToolResultPart.make(...)` / `ToolDefinition.make(...)`** — model and tool-related constructors from the canonical schema model.
- **`LLMEvent.is.*`** — typed guards (`is.textDelta`, `is.toolCall`, `is.finish`, …) for filtering streams.
- **`Image.request` / `generate` / `stream` / `start` / `resume`** — images over inline, streaming (partial previews), and queued routes through a provider-neutral request and response model.
- **`ImageClient`** — Effect service and layer for image execution, parallel to `LLMClient`.
- **`Media`** — the shared asset type (`Media.Asset`, `Media.Source`) and constructors used by messages, tool results, and media requests.
- **`Generation`** — provider-neutral handle for an in-flight media generation (`await`, `refresh`, `cancel`, `events`) used by queued media routes.
- **`Speech.request` / `Speech.generate` / `Speech.stream`** — text-to-speech through a provider-neutral request; `SpeechClient` is its Effect service and layer.
- **`Transcription.request` / `generate` / `stream` / `start` / `resume`** — speech-to-text over inline, streaming, and queued routes; `TranscriptionClient` is its Effect service and layer.
- **`AIClient.layer` / `AIClient.layerWith(executor)`** — every modality client plus the request executor in one layer.
- **`@opencode/ai/promise`** — `AI.make({ layer? })` and a default `ai` client exposing `llm`, `image`, `video`, `speech`, and `transcription` as Promise / `AsyncIterable` APIs, plus `file`, `write`, `bytes`, `base64`, and `materialize` for assets.

## Testing

Use the deterministic test client from `@opencode/ai/testing` to script provider-neutral responses and inspect
the requests sent by code under test:

```ts
import { Effect } from "effect"
import { TestLLM } from "@opencode/ai/testing"

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

Compaction is opt-in. The package supports automatic compaction in OpenAI/Azure Responses and Anthropic Messages (including Claude on Vertex), and explicit compaction calls in OpenAI/Azure/xAI Responses. Model and deployment support still depends on the provider.

This is different from prompt caching, server-side history storage, or truncation. Compaction returns provider-owned context that must be replayed to continue the conversation.

### Explicit compaction

`LLMClient.compact(request)` (equivalently, `{ mechanism: "endpoint" }`) is the caller-controlled operation for OpenAI, Azure, and xAI Responses. It performs exactly one HTTP call to `/responses/compact`, using the selected route's endpoint, credentials, query, and HTTP middleware. It returns a `CompactionResponse` with `replacement: Message[]` and optional `usage`, not a normal generation response. This mechanism does not accept a WebSocket executor.

Prefer this operation, where supported, when the application owns compaction policy and durable context updates.

```ts
const compacted = Effect.gen(function* () {
  const result = yield* LLMClient.compact(request)
  const next = LLMRequest.update(request, {
    messages: result.replacement,
  })
  return yield* LLMClient.generate(next)
})
```

`replacement` replaces the complete input window. Do not append it to the original transcript or extract only the encrypted item: the provider may retain additional messages in its output. Retained user and assistant messages remain ordinary messages with typed text, media, or reasoning parts, in their original order. Provider-specific message IDs, status, and phase use `providerMetadata`, not a raw output array hidden in an assistant message. Unsupported returned item types fail explicitly.

The selected model carries explicit-compaction capability through request construction and updates. Calls using unsupported routes fail type checking. When the model is selected dynamically, narrow the request with `LLMClient.canCompact(request)` before calling `LLMClient.compact`; a model or route switch does not inherit the old capability. Runtime validation still rejects unsupported calls from untyped consumers. Capability describes the route's API, not whether every model or custom deployment supports the operation.

Generation-only body overlays such as `stream` and `store` are not sent to the compact endpoint. Supported compact controls such as service tier and prompt-cache settings preserve request defaults and HTTP-overlay precedence. Retained image and file detail settings survive serialization and replay.

The input must still fit the model's context window. Explicit compaction is not an overflow-recovery operation. Anthropic does not expose this operation in this package; its in-band compaction remains available below. Compatible routes do not inherit an explicit compact endpoint simply because they use a Responses protocol.

### Streamed checkpoint compaction

OpenAI Responses also exposes a separate, explicitly selected mechanism:

```ts
const checkpoint = Effect.gen(function* () {
  const result = yield* LLMClient.compact(request, {
    mechanism: "trigger",
    webSocket, // Optional: without it, the request uses HTTP/SSE.
  })

  result.checkpoint // Successful encrypted CompactionPart.
  result.responseID
  result.usage
})
```

This appends a native `compaction_trigger` control item to the full input and sends a normal Responses request, with tools and instructions retained, `stream: true`, `store: false`, and parallel tool calls enabled. It removes normal-answer text/output-format controls, forced tool choices, output-token/tool-call limits, and automatic `context_management`. Body overlays cannot replace `input` or supply `previous_response_id`/`conversation`; the complete canonical history is required for safe stateless replay. Request metadata, auth, headers, query parameters, service tier, and supported prompt-cache settings are preserved.

Only a successful `response.completed` with a response ID and exactly one logical encrypted checkpoint succeeds. Repeated item events are correlated by ID/output slot, including ID-less checkpoints. Other output is ignored, not returned as assistant text or dispatched as tools. Failed, incomplete, malformed, and interrupted responses return errors rather than partial checkpoints.

The result is **not a replacement window**. The caller selects retained history, combines it with `result.checkpoint`, and durably installs it before continuing. The operation does not choose a retention budget, prune messages, or modify the original request.

The supplied WebSocket executor can reuse a compatible append baseline for the compaction request. On completion the protocol supplies no continuation checkpoint, clearing the old baseline so the next generation sends the newly installed window in full. Validation occurs before transport completion is acknowledged. There is no operation-level retry or fallback to `/responses/compact`; existing safe transport fallback may use SSE, with full history and no connection-local response ID.

Trigger support is separate from endpoint support. Only the OpenAI Responses route advertises it; Azure, xAI, Chat, and compatible Responses routes do not inherit it. Untyped calls still fail before sending: missing route capabilities return `UnsupportedOperation`, while unknown mechanism names and invalid inputs return `InvalidRequest`. Dynamic callers must narrow for the selected mechanism:

```ts
const narrowed = Effect.gen(function* () {
  if (LLMClient.canCompact(request, { mechanism: "trigger" })) {
    const result = yield* LLMClient.compact(request, { mechanism: "trigger" })
  }
})
```

This capability describes protocol implementation, **not universal availability on OpenAI API deployments**. The host application owns subscription/deployment eligibility, OAuth, endpoint selection, and deployment-specific headers. Local protocol/socket tests do not establish live provider support.

### Advanced: in-band compaction

`providerOptions.contextManagement` lets the provider decide when to compact during an ordinary `generate` or `stream` call. This is an advanced option for callers that own persistence and recovery: persist the complete assistant message, including its checkpoint, before continuing. Enabling the option does not provide durable checkpoint storage, interruption recovery, or model-switch policy. Keep the prior context until a successful checkpoint has been persisted.

Enable OpenAI compaction with typed provider options:

```ts
import { Effect } from "effect"
import { LLM, LLMClient, LLMRequest, Message } from "@opencode/ai"
import { OpenAI } from "@opencode/ai/providers"

const request = LLM.request({
  model: OpenAI.configure({ apiKey }).responses("gpt-5.3-codex"),
  messages,
  providerOptions: {
    contextManagement: [{ type: "compaction", compactThreshold: 200_000 }],
  },
})
const continued = Effect.gen(function* () {
  const response = yield* LLMClient.generate(request)
  return LLMRequest.update(request, {
    messages: [...request.messages, response.message, Message.user("Continue")],
  })
})
```

`store: false` remains the default. Keep the entire `response.message`, not just `response.text`. Compaction events become ordered `CompactionPart`s alongside text and reasoning. The conversation contains everything needed to continue; there is no separate replay object or hidden provider transcript.

A compaction part has `provider` and exactly one representation: `encrypted` for Responses, or `text` for Anthropic. Responses also preserves the optional checkpoint `id`. These fields survive message serialization without becoming visible assistant text. Sending a checkpoint to another provider or an incompatible API fails rather than silently losing context.

```ts
import { CompactionPart, ProviderID } from "@opencode/ai"

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

### Recording tests

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

`"auto"` places up to four breakpoints — the last tool definition, the first system part, the last system part when distinct, and the final message boundary. These expose successively larger reusable prefixes for tool definitions, system instructions, and the active conversation. The rolling final-message boundary advances on every request so recent conversation prefixes remain reusable during tool loops.

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
import { OpenAI, CloudflareAIGateway } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).responses("gpt-4o-mini")
const gateway = CloudflareAIGateway.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN,
}).model("workers-ai/@cf/meta/llama-3.1-8b-instruct")
```

Included LLM providers: OpenAI, Anthropic, Google (Gemini), Google Vertex, Amazon Bedrock, Azure OpenAI, Baseten, Cerebras, Cloudflare AI Gateway, Cloudflare Workers AI, DeepInfra, DeepSeek, Fireworks, Groq, Mistral, OpenRouter, TogetherAI, and xAI. Z.ai currently exposes image generation. Generic Chat Completions, Responses, and Anthropic Messages-compatible entrypoints support custom endpoints.

Each named provider owns its module, endpoint, authentication, and route setup. Providers with the same wire format compose the shared protocol directly:

```ts
import { DeepSeek, Fireworks } from "@opencode/ai/providers"

const deepseek = DeepSeek.configure({ apiKey }).model("deepseek-chat")
const fireworks = Fireworks.configure({ apiKey }).model("accounts/fireworks/models/my-model")
```

The former `OpenAICompatible.baseten`, `.cerebras`, `.deepinfra`, `.deepseek`, `.fireworks`, `.groq`, and `.togetherai` presets are replaced by the top-level `Baseten`, `Cerebras`, `DeepInfra`, `DeepSeek`, `Fireworks`, `Groq`, and `TogetherAI` exports. Use `CloudflareAIGateway` and `CloudflareWorkersAI` directly; each has its own module. `OpenAICompatible` configures generic endpoints with an explicit `baseURL`.

### Provider entrypoints

Provider modules are available through dedicated exports from `@opencode/ai`. Each LLM entrypoint exports `model(modelID, settings)`, where `settings` contains provider configuration plus common `headers` and `body` overlays.

```ts
import { model } from "@opencode/ai/providers/openai/responses"

const selected = model("gpt-5", {
  apiKey: process.env.OPENAI_API_KEY,
  headers: { "x-application": "example" },
})
```

APIs have separate entrypoints:

- `@opencode/ai/providers/openai/chat`
- `@opencode/ai/providers/openai/responses`
- `@opencode/ai/providers/openai-compatible/responses`
- `@opencode/ai/providers/anthropic-compatible`
- `@opencode/ai/providers/google-vertex/gemini`
- `@opencode/ai/providers/google-vertex/chat`
- `@opencode/ai/providers/google-vertex/responses`
- `@opencode/ai/providers/google-vertex/messages`

OpenAI Responses has one semantic route and uses HTTP by default. Advanced callers may supply a per-call WebSocket channel executor through `StreamOptions`; transport policy does not change provider settings, model identity, or route identity. The provider-neutral Open Responses implementation owns the reusable WebSocket request and event contract, while each provider opts in with its own handshake and connection policy. Azure follows the same Chat/Responses split at `providers/azure/chat` and `providers/azure/responses`. Generic OpenAI-compatible Chat remains at `providers/openai-compatible`; the Responses adapter at `providers/openai-compatible/responses` uses the provider-neutral Open Responses protocol. OpenAI Responses extends that baseline with OpenAI tools, event variants, metadata, and defaults. Generic Anthropic Messages-compatible providers use `providers/anthropic-compatible`, which the named Anthropic provider composes. Google Gemini and Amazon Bedrock expose their single native API through their existing provider paths.

Vertex Gemini, Vertex Chat, Vertex Responses, and Vertex Messages are separate API entrypoints. All accept `project`, `location`, and an optional `accessToken`; when no explicit token or auth override is supplied they lazily use Google Application Default Credentials. Vertex Gemini instead selects express mode when `apiKey` or `GOOGLE_VERTEX_API_KEY` is present. Vertex Chat targets MaaS models through the OpenAI-compatible Chat Completions endpoint, while Vertex Responses targets Grok models and defaults `store` to `false` as required by Vertex. `providers/google-vertex` remains the default alias for `providers/google-vertex/gemini`.

Tuned Vertex Gemini deployments use model ids shaped like `endpoints/1234567890` and require OAuth or ADC; Vertex express-mode API keys support publisher models only.

```ts
import { model } from "@opencode/ai/providers/google-vertex/gemini"

model("gemini-3.5-flash", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode/ai/providers/google-vertex/chat"

model("deepseek-ai/deepseek-v3.2-maas", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode/ai/providers/google-vertex/responses"

model("xai/grok-4.20-reasoning", { project: "my-project", location: "global" })
```

```ts
import { model } from "@opencode/ai/providers/google-vertex/messages"

model("claude-sonnet-4-6", { project: "my-project", location: "global" })
```

Additional provider entrypoints include:

- `@opencode/ai/providers/baseten`
- `@opencode/ai/providers/deepseek`
- `@opencode/ai/providers/fireworks`
- `@opencode/ai/providers/cloudflare-ai-gateway`
- `@opencode/ai/providers/cloudflare-workers-ai`

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

Compose a route with `Route.make({ protocol, endpoint, auth, framing, ... })`. The route owns endpoint/auth/framing and the protocol owns body construction plus stream parsing. Transports receive the route's endpoint and auth when preparing requests. Unsupported request shapes fail during protocol lowering.

## Effect

This package is built on Effect. Public methods return `Effect` or `Stream`; provide `AIClient.layer` (or `AIClient.layerWith(executor)`) for every modality, then import the provider/protocol modules for the routes you use. The example at `example/tutorial.ts` is a runnable walkthrough.

## See also

- `AGENTS.md` — architecture, route construction, contributor guide
- `example/tutorial.ts` — runnable end-to-end walkthrough
- `test/provider/*.test.ts` — fixture-first protocol tests; `*.recorded.test.ts` files cover live cassettes
