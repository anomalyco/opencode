# @opencode/ai-sdk-provider

The [OpenCode](https://opencode.ai) inference provider for [Vercel's AI SDK](https://ai-sdk.dev). One key reaches
every model OpenCode serves, OpenCode Go, and your workspace's own provider connections, and every response says what
it cost.

```sh
npm install @opencode/ai-sdk-provider ai
```

```ts
import { opencode } from "@opencode/ai-sdk-provider"
import { generateText } from "ai"

const { text, providerMetadata } = await generateText({
  model: opencode("claude-sonnet-5-5"),
  prompt: "Write a haiku about the sea.",
})

providerMetadata?.opencode?.usage
// { cost: 0.00041, listCost: 0.00041, billingSource: "balance", tokens: { input: 12, output: 24, ... } }
```

The key is read from `OPENCODE_API_KEY`: a service account key from your workspace in the
[OpenCode Console](https://opencode.ai/console). `createOpenCode` takes `apiKey`, `baseURL`, `headers` and
`fetch` to configure another instance:

```ts
import { createOpenCode } from "@opencode/ai-sdk-provider"

const opencode = createOpenCode({ apiKey: process.env.MY_OPENCODE_KEY })
```

## Models

`opencode(id)` takes any model ID OpenCode lists, and a provider before the model:

```ts
opencode("gpt-5.6-sol") // OpenCode's models
opencode("opencode-go/glm-5.3") // OpenCode Go
opencode("console-openrouter/anthropic/claude-sonnet-4-6") // a workspace connection, billed to its own key
```

Go models need an active Go subscription and a session ID per conversation, sent as a header:

```ts
await generateText({
  model: opencode("opencode-go/glm-5.3"),
  prompt: "…",
  headers: { "x-opencode-session": conversationID },
})
```

Each model is called through its native API, so reasoning, prompt caching and tools work as they do with the model's
own provider: Claude through Anthropic Messages, GPT through OpenAI Responses, Gemini through `generateContent`, and
the rest through Chat Completions. The package lists every model OpenCode served when it was released; any other model,
such as a workspace connection's, is matched by name (`claude-*`, `gpt-*`, `gemini-*`, else Chat Completions).
OpenCode translates a request sent in another API, so every model works whichever API it's sent in. To choose one:

```ts
opencode.messages("console-acme/my-claude")
opencode.responses(id)
opencode.chat(id)
opencode.google(id)
```

Embeddings use OpenAI's embeddings API for every embedding model:

```ts
import { embed } from "ai"

const { embedding, providerMetadata } = await embed({
  model: opencode.embeddingModel("text-embedding-3-small"),
  value: "sunny day at the beach",
})
```

## Usage and cost

Every response carries what OpenCode charged at `providerMetadata.opencode.usage`, on `generateText`, at the end of
`streamText` (`await result.providerMetadata`) and on `embed`:

- `cost`: USD charged to the balance or the next invoice, `0` when the model is free or Go's allowance covers it. For a
  workspace connection it's an estimate of what the provider charges, with `estimated: true`, or the provider's own
  figure when it reports one. Absent for a model without a price.
- `listCost`: USD at the model's list price.
- `billingSource`: `free`, `balance`, `go`, `go-plus` or `byok`.
- `allowance`: Go allowance used, in USD.
- `tokens`: the tokens billed: `input` (excluding cache reads and writes), `output` (including `reasoning`),
  `reasoning`, `cacheRead`, `cacheWrite5m` and `cacheWrite1h`.

## Development

`bun run models` regenerates `src/models.ts` from OpenCode's model lists. Run it before a release.
