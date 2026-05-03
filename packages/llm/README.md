# @opencode-ai/llm

Schema-first LLM core for opencode.

This package defines one typed request, response, event, and tool language, then lowers that language into provider-native HTTP requests. Provider quirks live in adapters and patches, not in session code.

## Design

The package is built around five layers:

1. `LLM` is the domain DSL. It constructs models, requests, messages, content parts, tool calls, tool results, and output summaries.
2. `Adapter` lowers an `LLMRequest` into one provider protocol. The usual shape is `Adapter.fromProtocol({ id, protocol, endpoint, auth, framing })`.
3. `Patch` applies named, traceable compatibility transforms at explicit phases: `request`, `prompt`, `tool-schema`, `target`, and `stream`.
4. `Conversation` folds streamed `LLMEvent`s into assistant content, executable tool calls, finish reason, semantic deltas, and continuation requests.
5. `ToolRuntime` runs typed tools by decoding model tool input with Effect Schema, executing handlers, encoding results, and continuing the model loop.

The core rule is that `LLMRequest` stays provider-neutral. Anything provider-specific belongs in `packages/llm/src/provider/*` or in a named patch.

## Quick Start

```ts
import { Effect } from "effect"
import { LLM, OpenAIChat, RequestExecutor, client } from "@opencode-ai/llm"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
})

const request = LLM.request({
  model,
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 40, temperature: 0 },
})

const program = Effect.gen(function* () {
  const response = yield* client({ adapters: [OpenAIChat.adapter] }).generate(request)
  return LLM.outputText(response)
}).pipe(Effect.provide(RequestExecutor.defaultLayer))
```

## Request DSL

Use constructors from `LLM` instead of assembling raw objects when possible.

```ts
const request = LLM.request({
  model,
  system: [LLM.system("You are helpful."), LLM.system("Answer directly.")],
  messages: [
    LLM.user("What is the weather in Paris?"),
    LLM.assistant([
      LLM.toolCall({
        id: "call_1",
        name: "get_weather",
        input: { city: "Paris" },
      }),
    ]),
    LLM.toolResultMessage({
      id: "call_1",
      name: "get_weather",
      result: { temperature: 22, condition: "sunny" },
    }),
  ],
  toolChoice: LLM.toolChoiceFor("get_weather"),
})
```

Useful `LLM` helpers:

- `LLM.model(...)` creates a provider-neutral model reference.
- `LLM.request(...)` normalizes ergonomic input into `LLMRequest`.
- `LLM.updateRequest(...)` patches a request without losing normalized fields.
- `LLM.user(...)` and `LLM.assistant(...)` create messages.
- `LLM.toolCall(...)`, `LLM.toolResult(...)`, and `LLM.toolResultMessage(...)` create tool history.
- `LLM.outputText(...)`, `LLM.outputReasoning(...)`, `LLM.outputToolCalls(...)`, and `LLM.outputUsage(...)` summarize streamed events.

## Adapters

Adapters are selected by `request.model.protocol`.

Built-in adapters include:

- `OpenAIChat.adapter`
- `OpenAIResponses.adapter`
- `OpenAICompatibleChat.adapter`
- `AnthropicMessages.adapter`
- `Gemini.adapter`
- `BedrockConverse.adapter`

Provider helpers such as `OpenAIChat.model(...)` and `Gemini.model(...)` stamp the model with the right provider, protocol, base URL, capabilities, and caller-provided limits.

```ts
const prepared = yield* client({
  adapters: [OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage])],
}).prepare(request)

console.log(prepared.target)
console.log(prepared.redactedTarget)
console.log(prepared.patchTrace)
```

Use `prepare(...)` to inspect the provider-native payload without sending it.

## Tools

`Conversation` owns the shared stream-to-history semantics. It answers two questions: given the events from one model round, what assistant content and tool calls should be carried into the next request; and what did each raw event mean semantically?

```ts
import { Conversation } from "@opencode-ai/llm"

const state = Conversation.empty()
const deltas = Conversation.mutate(state, {
  type: "tool-call",
  id: "call_1",
  name: "get_weather",
  input: { city: "Paris" },
})

const call = Conversation.clientToolCallAdded(deltas)
if (call) {
  // Dispatch local tools from semantic meaning, not raw provider event shape.
  console.log(call)
}

const folded = Conversation.fold(events)

const next = Conversation.continueRequest({
  request,
  state: folded,
  results: [
    { id: "call_1", name: "get_weather", result: { temperature: 22 } },
  ],
})
```

`ToolRuntime` builds on that conversation algebra and adds typed tool execution.

`defineTool(...)` bundles a description, parameter schema, success schema, and handler. The record key becomes the wire tool name.

```ts
import { Effect, Schema, Stream } from "effect"
import { LLM, OpenAIChat, RequestExecutor, ToolFailure, ToolRuntime, client, defineTool } from "@opencode-ai/llm"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
})

const get_weather = defineTool({
  description: "Get current weather for a city.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({
    temperature: Schema.Number,
    condition: Schema.String,
  }),
  execute: ({ city }) =>
    city === "FAIL"
      ? Effect.fail(new ToolFailure({ message: `Weather lookup failed for ${city}` }))
      : Effect.succeed({ temperature: 22, condition: "sunny" }),
})

const stream = ToolRuntime.run(client({ adapters: [OpenAIChat.adapter] }), {
  request: LLM.request({
    model,
    system: "Use the weather tool, then answer.",
    prompt: "What is the weather in Paris?",
  }),
  tools: { get_weather },
  maxSteps: 10,
})

const program = Stream.runCollect(stream).pipe(Effect.provide(RequestExecutor.defaultLayer))
```

Tool handlers should return typed success values or fail with `ToolFailure`. Unknown tools, invalid inputs, and invalid outputs become model-visible tool errors when they are recoverable.

## Patches

Patches keep provider compatibility logic explicit and traceable.

```ts
import { LLM, OpenAIChat, Patch, ProviderPatch, client } from "@opencode-ai/llm"

const llm = client({
  adapters: [OpenAIChat.adapter],
  patches: [
    ProviderPatch.cachePromptHints,
    Patch.prompt("trim-text", {
      reason: "trim text before provider lowering",
      apply: (request) =>
        LLM.updateRequest(request, {
          messages: request.messages.map((message) =>
            LLM.message({
              ...message,
              content: message.content.map((part) =>
                part.type === "text" ? { ...part, text: part.text.trim() } : part,
              ),
            }),
          ),
        }),
    }),
  ],
})
```

Patch trace IDs include their phase, for example `prompt.trim-text` or `tool-schema.gemini.sanitize`.

## Adding A Provider

Prefer the four-axis adapter shape:

1. Define provider schemas and stream state in `src/provider/<provider>.ts`.
2. Create a `Protocol` with `prepare`, `validate`, `encode`, `decode`, `process`, and finish handling.
3. Choose an `Endpoint`, `Auth`, and `Framing` implementation.
4. Export `adapter`, `model(...)`, and a namespace export like `export * as ProviderName from "./provider-name"`.

Only use `Adapter.unsafe(...)` when the provider cannot fit `Protocol`, `Endpoint`, `Auth`, and `Framing` cleanly.

## Testing

Run commands from `packages/llm`:

```sh
bun typecheck
bun test
```

Recorded tests use `@opencode-ai/http-recorder`. To update recordings, run the relevant test with `RECORD=true` and inspect the cassette for redaction before committing.

Use the credential helper to see which local keys are present and add missing ones to `packages/llm/.env.local`:

```sh
bun run setup:recording-env
bun run setup:recording-env -- --check
bun run setup:recording-env -- --providers groq,openrouter,xai
```

`.env.local` is ignored by git. Shared team credentials should live in a password manager or vault; this helper only writes your local test environment.
