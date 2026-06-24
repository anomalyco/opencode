# AI Library Design

> Discussion draft. This document describes the intended replacement for the
> current private `@opencode-ai/llm` API. Names and exact TypeScript signatures
> are illustrative until implementation, but the domain boundaries and defaults
> are deliberate.

## Status

- Proposed package: `@opencode-ai/ai`
- Initial stable domain: `LLM`
- Release posture: pre-1.0, with a stable-core intent
- Migration posture: clean break; do not preserve compatibility aliases
- Primary audience: general-purpose TypeScript developers using Effect
- Secondary audience: OpenCode and other durable agent runtimes

The package name leaves room for future domains such as embeddings, images, and
speech. Those domains are not part of this design and should not be forced into
the LLM run/turn model.

## Goals

1. Make a useful model call require very little code.
2. Make the default behavior good enough that most callers do not configure it.
3. Let advanced callers inspect, transform, or replace every important stage.
4. Keep provider quirks behind provider and protocol boundaries.
5. Preserve one provider turn as an explicit primitive for durable runtimes.
6. Keep serializable request data separate from process-local execution behavior.
7. Make unsupported combinations fail locally with useful typed errors.
8. Stay Effect-native without making package-specific service provisioning part
   of every call site.

## Non-goals

- A global provider or model registry
- Durable agent orchestration or persistence
- Session history ownership
- Permission handling
- Cost billing or accounting guarantees
- Runtime model-catalog network requests
- Compatibility with the current private API
- Designing embeddings, image generation, speech, or transcription now

## Design Principles

### Progressive disclosure

The API has four layers:

1. **Run a model** with `LLM.generate` or `LLM.stream`.
2. **Control one provider turn** with `LLM.generateTurn` or `LLM.streamTurn`.
3. **Customize execution** with model defaults, call options, hooks, and provider
   configuration.
4. **Author providers** with experimental provider definitions and protocols.

Normal documentation should teach only the first layer initially.

### Values over registries

Provider definitions, configured providers, models, protocols, tools, and hooks
are immutable values. Importing a provider does not register anything globally.

### Portable data, local behavior

Requests, messages, tool definitions, events, usage, and result projections are
plain immutable data with schemas. Configured models, executable tools, hooks,
and provider definitions may contain functions and Effect requirements and are
not serializable.

### Strong defaults, explicit overrides

Defaults should make common calls correct without hiding where behavior comes
from. Overrides compose in a documented order and never require patching
installed dependencies.

## Domain Model

### Provider Definition

An immutable, declarative description of a provider integration. It owns model
selection, option schemas, catalog corrections, protocols, and provider-wide
hooks. It is an experimental provider-authoring API.

### Configured Provider

A provider definition bound to deployment concerns such as credentials,
endpoint, transport, and provider headers.

`configure(...)` is intentionally deployment-only. It does not establish hidden
generation defaults.

### Model

A process-local executable model value selected from a configured provider. It
contains identity, capabilities, pricing metadata, provider-specific option
types, reusable request-behavior defaults, and hidden execution behavior.

Normal users do not need to learn the current `Route` composite. Protocol,
endpoint, auth, transport, and hooks are bound behind `Model`.

### Request

Portable, model-independent input for a model call. It may contain system
instructions, messages, tool definitions, generation controls, output intent,
cache policy, and metadata. It does not contain a configured model, executable
tool handlers, or hooks.

### Provider Turn

Exactly one request to a model provider and its normalized response. It does not
execute local tools or continue the conversation.

### Model Run

A complete interaction consisting of one or more provider turns. A run executes
local tools, appends their results, and continues until the model completes or a
stopping condition matches.

### TurnResult

The result of exactly one provider turn.

### GenerateResult

The result of a complete model run. It preserves every turn, tool activity,
aggregate usage, and estimated cost while exposing shortcuts to the final output.

### Protocol

The provider-wire contract that lowers portable requests into provider-native
bodies and raises provider-native stream events into normalized turn events.
Protocols are public, reusable, fully inspectable, and immutably patchable, but
the entire protocol-authoring API is experimental.

## Happy Path

### Effect

```ts
import { Effect } from "effect"
import { LLM } from "@opencode-ai/ai"
import { OpenAI } from "@opencode-ai/ai/providers/openai"

// Environment-based credentials are a provider default. No LLMClient layer is
// required: the Effect exposes standard runtime dependencies directly.
const model = OpenAI.model("gpt-4.1-mini")

const program = Effect.gen(function* () {
  const result = yield* LLM.generate({
    model,
    system: "You are concise.",
    prompt: "Explain Effect in one sentence.",
  })

  // `generate` always returns GenerateResult, even when the run has one turn.
  console.log(result.text)
  console.log(result.turns.length) // 1
  console.log(result.usage)
  console.log(result.cost) // Estimated cost, or undefined if any turn is unpriced.
})
```

The required Effect environment should contain standard services plus services
required by tools and hooks. It should not contain an `LLMClient` wrapper service.

### Current API

The current README appears similarly small but omits the package-specific service
and layer required at runtime:

```ts
// Current API: this request contains an executable model/route value.
const request = LLM.request({
  model: OpenAI.configure({ apiKey }).responses("gpt-4o-mini"),
  prompt: "Say hello.",
})

// Current API: this performs one provider turn, despite the broad name.
const response = yield* LLM.generate(request)

// Current API: execution also needs LLMClient.layer and RequestExecutor services.
```

The proposal removes mandatory request construction, removes package-specific
runtime provisioning, and makes `generate` mean a complete run.

## Provider And Model Selection

### Environment defaults

```ts
import { OpenAI } from "@opencode-ai/ai/providers/openai"

// Open strings receive autocomplete for IDs from the generated models.dev
// snapshot but continue to accept newly released and fine-tuned model IDs.
const model = OpenAI.model("gpt-4.1-mini")
```

### Deployment configuration

```ts
const openai = OpenAI.configure({
  apiKey,
  baseURL: "https://gateway.example.com/openai/v1",
  headers: {
    "x-tenant": "acme",
  },
})

const model = openai.model("gpt-4.1-mini")
```

`configure(...)` owns deployment concerns only:

- Credentials and authentication
- Base URL and deployment location
- Transport selection
- Provider/deployment headers
- Other provider-specific connection setup

It does not own temperature, maximum output tokens, cache policy, retry policy,
tools, output schema, or system instructions.

### Reusable model defaults

```ts
const model = OpenAI.model("gpt-4.1-mini", {
  generation: {
    temperature: 0.2,
    maxTokens: 2_000,
  },
  cache: "auto",
  provider: {
    store: false,
  },
})
```

The second argument may default request behavior but not prompt/history or
executable tools. Call-level values override model defaults.

Provider-specific options are inferred from the concrete model:

```ts
yield* LLM.generate({
  model: OpenAI.model("gpt-4.1-mini"),
  prompt: "Hello",
  provider: {
    store: false,
    // OpenAI-specific autocomplete here; no `{ openai: ... }` nesting.
  },
})
```

Code choosing between providers dynamically must narrow the model before using
provider-specific options. Portable generation controls remain available without
narrowing.

### Current API

```ts
// Current API mixes deployment configuration and reusable request behavior.
const model = OpenAI.configure({
  apiKey,
  generation: { maxTokens: 160 },
  providerOptions: {
    openai: { store: false },
  },
}).model("gpt-4o-mini")
```

The proposal separates deployment configuration from selected-model behavior and
removes provider-keyed option bags when a concrete model already identifies the
provider.

## Requests

### Inline input

```ts
const result = yield* LLM.generate({
  model,
  system: "You are concise.",
  prompt: "Summarize this pull request.",
  generation: { maxTokens: 500 },
})
```

### Reusable portable request

```ts
const request = LLM.request({
  system: "You are concise.",
  prompt: "Summarize this pull request.",
  generation: { maxTokens: 500 },
})

// Bind process-local execution behavior only when running.
const result = yield* LLM.generate({ model, request })
```

`LLM.request(...)` returns a plain immutable object. Use ordinary object spread
to derive another request:

```ts
const longer = {
  ...request,
  generation: {
    ...request.generation,
    maxTokens: 1_000,
  },
}
```

There is no `LLM.updateRequest(...)` helper and no request Schema class.

### Conversation history

```ts
import { Message } from "@opencode-ai/ai"

const request = LLM.request({
  system: "You are concise.",
  messages: [
    Message.user("What is Effect?"),
    Message.assistant("A TypeScript library for typed functional effects."),
    Message.user("Why would I use it?"),
  ],
})
```

Message helpers return plain immutable data. Object literals remain valid when
they satisfy the same input type.

`system` stays separate from chronological messages because it is the initial
privileged instruction. A chronological system message represents an instruction
change at a specific point in history.

## Complete Runs

### Automatic local tool loop

```ts
import { Effect, Schema } from "effect"
import { LLM, Tool } from "@opencode-ai/ai"

const tools = {
  getWeather: Tool.make({
    description: "Get current weather for a city.",
    parameters: Schema.Struct({ city: Schema.String }),
    success: Schema.Struct({ forecast: Schema.String }),

    // Tool service requirements and typed errors flow into LLM.generate's
    // Effect environment/error model instead of being erased.
    execute: ({ city }) => Weather.get(city),

    // Expected domain failures need an explicit model-visible representation.
    formatError: (error) => ({
      type: "text",
      text: `Weather lookup failed: ${error.message}`,
    }),
  }),
}

const result = yield* LLM.generate({
  model,
  prompt: "What is the weather in London?",
  tools,
})

// The runtime advertises definitions, dispatches calls, records results, and
// continues provider turns automatically.
console.log(result.text)
console.log(result.turns)
console.log(result.toolExecutions)
```

The default stopping condition is equivalent to:

```ts
stopWhen: StopWhen.turnCount(20)
```

This matches the Vercel AI SDK `ToolLoopAgent` default. Reaching the limit is a
successful result with `stopReason: "max-turns"`, not an Effect failure.

### Custom stopping

```ts
const result = yield* LLM.generate({
  model,
  prompt,
  tools,
  stopWhen: StopWhen.any(
    StopWhen.turnCount(8),
    StopWhen.hasToolCall("finalize"),
  ),
})
```

`stopWhen` accepts one predicate. Composition is explicit through combinators
such as `StopWhen.any`, `StopWhen.all`, and `StopWhen.not`.

Successful run stop reasons are closed:

```ts
type RunStopReason = "completed" | "max-turns" | "stop-condition"
```

### Tool concurrency

Independent tool calls emitted in one turn run concurrently with a bounded,
configurable concurrency limit. Results are appended in deterministic emitted
order. The runtime does not infer dependencies between tool calls; the model must
request dependent calls in separate turns.

Tools may declare an optional timeout. The overall run timeout still applies.

### Current API

Today callers must manually bridge every layer:

```ts
const request = LLM.request({
  model,
  prompt,
  tools: Tool.toDefinitions(tools),
})

const events = yield* LLM.stream(request).pipe(Stream.runCollect)
const call = Array.from(events).find(LLMEvent.is.toolCall)

if (call && !call.providerExecuted) {
  const dispatched = yield* ToolRuntime.dispatch(tools, call)
  const followUp = LLM.updateRequest(request, {
    messages: [
      ...request.messages,
      Message.assistant([call]),
      Message.tool({ ...call, result: dispatched.result }),
    ],
  })
  // Caller must invoke the provider again and repeat the loop.
}
```

That explicit flow remains possible through turn APIs, but it is no longer the
only tool experience.

## One Provider Turn

OpenCode and other durable runtimes need to own persistence, tool settlement,
and continuation. They use the explicit turn API:

```ts
const result = yield* LLM.generateTurn({
  model,
  request,
  // Definitions only. generateTurn never dispatches local handlers.
  tools: {
    getWeather: Tool.definition({
      description: "Get current weather for a city.",
      parameters: WeatherInput,
    }),
  },
})

// Persist the TurnResult and settle calls durably before the next turn.
for (const call of result.toolCalls) {
  // Application-owned dispatch and persistence.
}
```

`generateTurn` and `streamTurn` make exactly one provider request. They never
execute a local tool and never continue automatically.

This separation is load-bearing:

- `generate` / `stream`: complete Model Run
- `generateTurn` / `streamTurn`: one Provider Turn

## Portable Tool Definitions

A portable request may declare serializable definitions, but executable handlers
are bound at run time:

```ts
const request = LLM.request({
  prompt: "What is the weather in London?",
  tools: {
    getWeather: Tool.definition({
      description: "Get current weather for a city.",
      parameters: WeatherInput,
    }),
  },
})

const result = yield* LLM.generate({
  model,
  request,
  tools: {
    getWeather: Tool.make({
      description: "Get current weather for a city.",
      parameters: WeatherInput,
      success: WeatherOutput,
      execute: getWeather,
      formatError,
    }),
  },
})
```

Definitions and handlers match by record key. Before the first provider call,
the runtime validates that every local definition has a compatible executable
binding. Missing or incompatible bindings fail with a typed tool-binding error.

Provider-hosted tools are distinct typed values:

```ts
const result = yield* LLM.generate({
  model: OpenAI.model("gpt-4.1"),
  prompt: "Find today's relevant announcements.",
  tools: {
    search: OpenAI.tool.webSearch({ searchContextSize: "medium" }),
  },
})
```

Hosted tools do not pretend to have local handlers, and callers do not inspect a
`providerExecuted` boolean to decide whether dispatch is safe.

## Streaming

### Run stream

`LLM.stream` returns an Effect `Stream<RunEvent, LLMError, Requirements>`.
Run events explicitly expose orchestration boundaries:

```ts
const program = LLM.stream({ model, prompt, tools }).pipe(
  Stream.tap((event) =>
    Effect.sync(() => {
      switch (event.type) {
        case "run-start":
          break
        case "turn-start":
          break
        case "turn-event":
          // Normalized text, reasoning, tool-call, usage, and finish events.
          if (event.event.type === "text-delta") {
            process.stdout.write(event.event.text)
          }
          break
        case "tool-start":
          break
        case "tool-finish":
          break
        case "turn-finish":
          break
        case "run-finish":
          // Contains the same full GenerateResult returned by LLM.generate.
          console.log(event.result.usage)
          break
      }
    }),
  ),
  Stream.runDrain,
)
```

Exact event tag spelling remains an implementation detail to finalize, but the
algebra is settled:

- A separate `RunEvent` union for run, turn, and tool lifecycle
- A focused `TurnEvent` union for normalized provider output
- `streamTurn` emits only `TurnEvent`
- The terminal run event contains the full `GenerateResult`

External cancellation remains Effect interruption. It does not fabricate a
successful result with an `interrupted` stop reason.

## Structured Output

Structured output is an option on `generate`, not a separate operation:

```ts
const Weather = Schema.Struct({
  city: Schema.String,
  forecast: Schema.String,
  highCelsius: Schema.Number,
})

const result = yield* LLM.generate({
  model,
  prompt: "Give me today's weather for London.",
  output: Weather,
})

// Inferred from Weather.
result.output.city
```

The model declaration and protocol select the best reliable strategy:

1. Provider-native structured output when supported and reliable
2. Forced tool output when required as a compatibility fallback
3. Typed unsupported-capability failure before network execution when neither is
   available

Advanced callers may override the strategy when exact provider semantics matter.

### Current API

```ts
// Current API is a separate operation and always forces a synthetic tool.
const result = yield* LLM.generateObject({
  model,
  prompt,
  schema: Weather,
})
```

The proposal unifies generation and lets capabilities choose the strategy rather
than permanently encoding one cross-provider workaround.

## Model Catalog

`models.dev` is the release-time source for:

- Model ID suggestions
- Capabilities and modalities
- Context and output limits
- Pricing
- Other available model metadata

The package ships a generated, versioned snapshot. Normal execution performs no
catalog network requests.

Provider definitions may correct generated metadata where protocol-specific
knowledge is more accurate. Precedence is:

```text
models.dev snapshot
  < provider-definition correction
  < provider configuration override
  < model-selection override
  < call override
```

Unknown model IDs inherit only capabilities guaranteed by the selected protocol.
Unsupported request capabilities fail before network execution unless the caller
explicitly overrides the model declaration.

## Usage And Cost

`GenerateResult` aggregates normalized usage across every turn, including cache
read/write usage where providers report it.

It also exposes estimated cost using the generated models.dev pricing snapshot:

```ts
result.usage.inputTokens
result.usage.outputTokens
result.usage.cacheReadInputTokens
result.usage.cacheWriteInputTokens

result.cost?.total
result.cost?.currency // e.g. "USD"
```

Cost is an estimate, not a billing guarantee. If reliable pricing is unavailable
for any turn, aggregate run cost is unavailable rather than partial or silently
zero. Per-turn metadata should retain the catalog/pricing identity used so an
estimate can be explained.

## Caching

Prompt caching remains `"auto"` by default. The library places protocol-aware
cache boundaries where explicit caching is supported and does nothing on the wire
where providers cache implicitly.

```ts
yield* LLM.generate({
  model,
  prompt,
  cache: "none", // Explicit opt-out.
})
```

Granular cache policy remains available as an advanced request option.

## Retries, Timeouts, And Cancellation

### Retries

The default retry policy is deliberately conservative:

- Retry bounded transient transport and rate-limit failures
- Retry only before observable output
- Never silently retry after ambiguous tool execution or other side effects
- Allow each call to override or disable retry behavior

Retry configuration is call-scoped only. Provider and model configuration do not
silently inherit custom retry policies.

### Timeouts

```ts
yield* LLM.generate({
  model,
  prompt,
  timeout: "2 minutes",       // Entire run, including tools.
  turnTimeout: "30 seconds",  // Each provider turn.
  tools,
})
```

Exact Duration input spelling follows Effect conventions. Individual tools may
also declare optional timeouts.

### Cancellation

- Effect API: fiber interruption
- Promise API: `AbortSignal`, rejecting with a recognizable abort error
- Cancellation is not a successful run stop reason

## Hooks

Stable high-level hooks exist at five named stages:

1. Canonical request
2. Provider-native body
3. Prepared transport request
4. Normalized event
5. Error

Hooks are Effectful. They may transform the stage value or fail with a typed
error. They may not secretly short-circuit execution, synthesize a response,
retry, or redirect control flow.

```ts
const model = OpenAI.model("gpt-4.1", {
  hooks: {
    request: (request) => Effect.succeed({
      ...request,
      metadata: { ...request.metadata, tenant: "acme" },
    }),
    body: (body, context) => auditBody(body, context),
    transport: (request) => signInternalGatewayRequest(request),
    event: (event) => redactProviderMetadata(event),
    error: (error) => classifyInternalError(error),
  },
})
```

Hook scopes compose in this order:

```text
provider-definition hooks -> model hooks -> call hooks
```

Each hook sees the prior hook's output. Replacement requires an explicit
definition-level patch, not accidental last-writer-wins semantics.

Provider-definition hooks are authored by provider integrations. They are not
passed through `Provider.configure(...)`, which remains deployment-only.

## HTTP And Provider Escape Hatches

The request customization ladder is:

1. Portable generation controls
2. Model-typed `provider` options
3. Stable staged hooks
4. Serializable HTTP/body overlays
5. Experimental provider-definition or protocol patching

```ts
yield* LLM.generate({
  model,
  prompt,
  http: {
    headers: { "x-experimental": "1" },
    query: { debug: "true" },
    body: { newlyReleasedProviderField: true },
  },
})
```

Raw overlays are intentional last-resort support for provider features that ship
before the library has a typed option.

## Provider-Native Metadata

Normalized message/content/event unions remain closed and exhaustive. Unknown or
provider-required round-trip data lives in caller-writable `providerMetadata`.

```ts
const assistant = Message.assistant([
  {
    type: "reasoning",
    text: "...",
    providerMetadata: {
      openai: {
        // Opaque provider data needed for replay or continuation.
      },
    },
  },
])
```

Protocols validate metadata they consume. The field is an escape hatch, not a
portable semantic guarantee.

## Error Model

The Effect error channel is a tagged domain union rather than one `LLMError`
wrapper with nested reasons. Illustrative categories:

```ts
type LLMError =
  | AuthenticationError
  | InvalidRequestError
  | UnsupportedCapabilityError
  | ToolBindingError
  | TransportError
  | ProviderResponseError
  | InvalidProviderOutputError
  | HookError
```

Each error retains relevant provider/model/turn/stage context and its underlying
cause where available.

Expected tool errors keep their own typed error channel. `Tool.make` requires an
explicit mapping before such errors become model-visible tool results. Expected
mapped failures let the model recover; defects and interruption fail the run.

## Observability

The core library emits Effect-native spans and metrics for:

- Model runs
- Provider turns
- Provider requests
- Retries
- Tool executions

Default telemetry records metadata only:

- Provider and model identity
- Timing
- Token/cache usage
- Estimated cost availability
- Finish and stop reasons
- Retry counts
- Tool names

Prompts, model output, tool arguments, and tool results are never recorded by
default. Explicit hooks or telemetry configuration may opt into content capture.

## Promise API

Promise wrappers live at a separate subpath so the root remains unambiguously
Effect-first:

```ts
import { LLM } from "@opencode-ai/ai/promise"
import { OpenAI } from "@opencode-ai/ai/providers/openai"

const result = await LLM.generate({
  model: OpenAI.model("gpt-4.1-mini"),
  prompt: "Explain Effect in one sentence.",
  signal: abortController.signal,
})
```

Streaming returns an `AsyncIterable<RunEvent>`:

```ts
for await (const event of LLM.stream({ model, prompt, signal })) {
  if (event.type === "turn-event" && event.event.type === "text-delta") {
    process.stdout.write(event.event.text)
  }
}
```

Top-level Promise functions use a default runtime for built-in services. Custom
Effect service requirements use a configured client:

```ts
const client = LLM.makeClient({
  layer: Layer.mergeAll(WeatherLive, AuditLive),
})

const result = await client.generate({ model, prompt, tools })
```

The Promise API mirrors Effect semantics. It does not invent different run,
error, stopping, or cancellation behavior.

## Schemas

Schemas live in a dedicated namespace/subpath instead of flooding root exports:

```ts
import { LLMSchema } from "@opencode-ai/ai/schema"

const request = yield* Schema.decodeUnknown(LLMSchema.Request)(input)
```

Schemas cover only serializable domain values:

- Requests and messages
- Portable tool definitions
- Turn and run events
- Serializable result projections
- Usage and cost estimates
- Tagged errors where serializable
- Provider metadata containers

Configured models, executable tools, hooks, provider definitions, and protocols
are process-local behavior and do not receive fake serialization schemas.

## Provider Authoring

Provider authoring is public but experimental.

### Declarative provider definition

```ts
import {
  Provider,
  Protocol,
} from "@opencode-ai/ai/provider"

export const ExampleAI = Provider.define({
  id: "example",
  options: ExampleProviderOptions,
  configure: configureExampleDeployment,
  protocols: {
    responses: ExampleResponses,
  },
  models: ({ deployment, catalog }) => ({
    model: (id, defaults) =>
      Provider.model({
        id,
        deployment,
        protocol: ExampleResponses,
        metadata: catalog.model(id),
        defaults,
      }),
  }),
  catalog: generatedExampleCatalog,
  corrections: exampleCatalogCorrections,
  hooks: exampleProviderHooks,
})
```

The exact builder fields need implementation design, but it must remain one
declarative immutable object, infer provider option types, and support `.with(...)`
patching. It must not register globally.

Built-ins export their immutable definition for advanced forking:

```ts
import { OpenAI } from "@opencode-ai/ai/providers/openai"

const PatchedOpenAI = OpenAI.definition.with({
  protocols: {
    responses: OpenAI.protocols.responses.with({
      // Explicit immutable stage patch.
      body: {
        fromRequest: patchResponsesBody,
      },
    }),
  },
})
```

### Protocols

A protocol exposes all native types and stages:

- Provider-native request body and schema
- Transport frame type
- Provider-native event and schema
- Parser state
- Request lowering
- Event stepping
- Terminal detection and final flushing

Every stage is immutably patchable. This is deliberately more open than the AI
SDK integrations that motivated this package.

```ts
const PatchedResponses = OpenAIResponses.with({
  body: {
    fromRequest: (request) =>
      OpenAIResponses.body.fromRequest(request).pipe(
        Effect.map((body) => ({ ...body, custom_field: true })),
      ),
  },
  stream: {
    step: patchResponsesStep,
  },
})
```

Protocol body, frame, native event, and parser-state types are exported. Because
provider wire formats change often, these types and patch APIs are explicitly
experimental and do not receive the high-level API's compatibility promise.

## Package Surface

Illustrative export layout:

```text
@opencode-ai/ai
  LLM
  Message
  Tool
  StopWhen
  stable domain types

@opencode-ai/ai/promise
  Promise/AsyncIterable LLM facade

@opencode-ai/ai/schema
  serializable domain schemas

@opencode-ai/ai/provider
  experimental Provider and Protocol authoring APIs

@opencode-ai/ai/providers/openai
@opencode-ai/ai/providers/anthropic
@opencode-ai/ai/providers/google
...
```

Providers are imported through individual subpaths. The root does not export all
providers, and there is no preferred all-providers barrel.

## Defaults

| Concern | Default |
| --- | --- |
| `LLM.generate` semantics | Complete Model Run |
| `LLM.generateTurn` semantics | Exactly one Provider Turn |
| Maximum turns | 20 |
| Turn-limit outcome | Successful `max-turns` result |
| Tool execution | Automatic in runs |
| Tool concurrency | Concurrent, bounded, deterministic result order |
| Prompt caching | `auto` |
| Retries | Conservative, pre-output transient failures only |
| Structured output | Capability-selected native or tool strategy |
| Capability mismatch | Typed failure before network execution |
| Unknown model capability | Conservative protocol baseline |
| Telemetry content | Metadata only |
| Cost | Estimated aggregate or unavailable |
| Cancellation | Interruption/rejection, never successful completion |

## Clean-break Migration

The redesign intentionally removes or changes these current concepts:

| Current | Proposed |
| --- | --- |
| `@opencode-ai/llm` | `@opencode-ai/ai` |
| Mandatory `LLM.request({ model, ... })` | Inline calls or model-free portable requests |
| `LLM.generate` means one turn | `LLM.generate` means complete run |
| `LLMClient.generate/stream` | `LLM.generateTurn/streamTurn` for one turn |
| `LLMClient.layer` requirement | Standard Effect requirements exposed directly |
| Public `Route` mental model | Hidden behind executable `Model` |
| `Provider.make` structural helper | Experimental declarative `Provider.define` |
| Schema classes as canonical values | Plain immutable values plus schema subpath |
| `LLM.updateRequest` | Object spread |
| `Tool.toDefinitions` in normal calls | Named executable tool records |
| Manual `ToolRuntime.dispatch` loop | Automatic run dispatch; explicit turn API for orchestration |
| `providerOptions: { openai: ... }` | Model-typed `provider: ...` |
| `generateObject` | Typed `output` option on `generate` |
| One event union for provider output | Separate `TurnEvent` and `RunEvent` unions |
| `providerExecuted` dispatch check | Distinct hosted-tool constructors |
| One wrapped `LLMError` | Tagged domain error union |

OpenCode should migrate to `generateTurn` / `streamTurn`, preserving its durable
prompt admission, persistence, permission, tool settlement, and continuation
boundaries. It should not use the automatic run API for Session orchestration.

## Remaining Implementation-level Questions

These do not reopen the main design:

1. Exact `RunEvent` and `TurnEvent` tag names and payloads
2. Exact `GenerateResult` shortcut fields for text, reasoning, output, and messages
3. Exact Provider definition TypeScript shape needed for strong inference
4. Exact protocol `.with(...)` patch syntax and replacement semantics
5. Exact Duration input fields and names
6. Exact models.dev generation pipeline and correction-file format
7. Exact cost representation and decimal arithmetic strategy
8. Exact default retry schedule and bounded tool concurrency number
9. Whether request-level serializable HTTP overlays belong in the stable schema
10. Which tagged errors are serializable versus process-local

These should be resolved with call-site sketches and implementation spikes rather
than by changing the domain boundaries above.
