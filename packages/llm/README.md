# @opencode-ai/llm

Schema-first LLM core for opencode. One typed request, response, event, and tool language; provider quirks live in adapters, not in calling code.

```ts
import { Effect } from "effect"
import { LLM, LLMClient } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"

const model = OpenAI.model("gpt-4o-mini", { apiKey: process.env.OPENAI_API_KEY })

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
```

Run `LLMClient.stream(request)` instead of `generate` when you want incremental `LLMEvent`s. The event stream is provider-neutral — same shape across OpenAI Chat, OpenAI Responses, Anthropic Messages, Gemini, Bedrock Converse, and any OpenAI-compatible deployment.

## Public API

- **`LLM.request({...})`** — build a provider-neutral `LLMRequest`. Accepts ergonomic inputs (`system: string`, `prompt: string`) that normalize into the canonical Schema classes.
- **`LLM.generate` / `LLM.stream`** — re-exported from `LLMClient` for one-import use.
- **`LLM.user(...)` / `LLM.assistant(...)` / `LLM.toolMessage(...)`** — message constructors.
- **`LLM.toolCall(...)` / `LLM.toolResult(...)` / `LLM.toolDefinition(...)`** — tool-related parts.
- **`LLMClient.prepare(request)`** — compile a request through protocol body construction, validation, and HTTP preparation without sending. Useful for inspection and testing.
- **`LLMEvent.is.*`** — typed guards (`is.text`, `is.toolCall`, `is.requestFinish`, …) for filtering streams.

## Caching

Prompt caching is unified across providers. Mark content with a `CacheHint` and each protocol translates it to its wire format (`cache_control` on Anthropic, `cachePoint` on Bedrock; OpenAI's implicit caching needs no markers).

### Auto placement

The simplest path is `cache: "auto"` on the request:

```ts
LLM.request({
  model,
  system,
  messages,
  tools,
  cache: "auto",
})
```

`"auto"` places three breakpoints — last tool definition, last system part, latest user message. The last-user-message boundary is the load-bearing detail: in a tool-use loop, a single user turn expands into many assistant/tool round-trips, all sharing that prefix. Caching at that boundary lets every intra-turn API call hit.

On OpenAI and Gemini `"auto"` is a no-op (their wire formats don't accept inline markers — both use implicit caching). On Anthropic and Bedrock it emits provider-native cache markers.

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

Inline `CacheHint` on any text / system / tool / tool-result part overrides automatic placement. The auto policy preserves manual hints; it only fills gaps.

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

| Protocol | `cache: "auto"` |
|---|---|
| Anthropic Messages | emits up to 3 `cache_control` markers (4-breakpoint cap enforced) |
| Bedrock Converse | emits up to 3 `cachePoint` blocks (4-breakpoint cap enforced) |
| OpenAI Chat / Responses | no-op (implicit caching above 1024 tokens) |
| Gemini | no-op (implicit caching on 2.5+; explicit `CachedContent` is out-of-band) |

Normalized cache usage is read back into `response.usage.cacheReadInputTokens` and `cacheWriteInputTokens` across every provider.

## Providers

Each provider exports a `model(...)` helper that records identity, protocol, capabilities, auth, and defaults.

```ts
import { Anthropic } from "@opencode-ai/llm/providers"

const model = Anthropic.model("claude-sonnet-4-6", {
  apiKey: process.env.ANTHROPIC_API_KEY,
})
```

Included providers: OpenAI, Anthropic, Google (Gemini), Amazon Bedrock, Azure OpenAI, Cloudflare, GitHub Copilot, OpenRouter, xAI, plus generic OpenAI-compatible helpers for DeepSeek, Cerebras, Groq, Fireworks, Together, etc.

## Provider options & HTTP overlays

Three escape hatches in order of stability:

1. **`generation`** — portable knobs (`maxTokens`, `temperature`, `topP`, `topK`, penalties, seed, stop).
2. **`providerOptions: { <provider>: {...} }`** — typed-at-the-facade provider-specific knobs (OpenAI `promptCacheKey`, Anthropic `thinking`, Gemini `thinkingConfig`, OpenRouter routing).
3. **`http: { body, headers, query }`** — last-resort serializable overlays merged into the final HTTP request. Reach for this only when a stable typed path doesn't yet exist.

Model-level defaults are overridden by request-level values for each axis.

## Routes

Adding a new model or deployment is usually 5–15 lines using `Route.make({ protocol, transport, ... })`. The four orthogonal pieces are protocol (body construction + stream parsing), transport (endpoint + auth + framing + encoding), defaults, and capabilities. See `AGENTS.md` for the architectural detail.

## Effect

This package is built on Effect. Public methods return `Effect` or `Stream`; provide `LLMClient.layer` (the default registers every shipped route) for runtime dispatch. The example at `example/tutorial.ts` is a runnable walkthrough.

## See also

- `AGENTS.md` — architecture, route construction, contributor guide
- `example/tutorial.ts` — runnable end-to-end walkthrough
- `test/provider/*.test.ts` — fixture-first protocol tests; `*.recorded.test.ts` files cover live cassettes
