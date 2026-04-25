# LLM core package

Spec for a standalone Effect Schema-based LLM package that can live inside this
repo first and later become a separate workspace package.

The package should not know about opencode sessions, database messages, tool
registries, or provider config. It should expose a small canonical LLM IR,
adapter contracts, provider target builders, stream event schemas, and a
composable patch system.

## Goal

Build a small library that turns typed LLM intent into provider-native requests
and provider-native streams back into typed LLM events.

The package pipeline is:

```text
LLMRequest
  -> request validation
  -> prompt/tool/schema patches
  -> adapter lowering
  -> target fragments
  -> target patches
  -> target validation / encoding
  -> transport
  -> provider chunk decoding
  -> event raising
  -> LLMEvent stream
```

The consumer pipeline is outside the package:

```text
consumer state
  -> LLMRequest
  -> @opencode-ai/llm stream
  -> LLMEvent
  -> consumer state updates
```

## Non-goals

- Do not depend on `MessageV2`, `SessionProcessor`, opencode tools, or opencode
  provider config.
- Do not preserve AI SDK as the internal abstraction.
- Do not build one universal provider request format.
- Do not represent every provider-native option in the common IR.
- Do not require tool execution to happen inside the package, though the package
  should provide an optional executor loop.

## Package shape

Proposed workspace package:

```text
packages/llm/
  package.json
  src/
    index.ts
    schema.ts             # common request, message, tool, event, usage, errors
    adapter.ts            # adapter interface and registry
    target.ts             # target builders and fragments
    patch.ts              # patch model, patch registry, traces
    transport.ts          # request transport interface and fetch transport
    stream.ts             # SSE and stream helpers
    tool-runtime.ts       # optional tool execution loop
    provider/
      openai-chat.ts
      openai-responses.ts
      anthropic.ts
      gemini.ts
      bedrock.ts
    patch/
      prompt.ts
      schema.ts
      reasoning.ts
      request.ts
```

Initial in-repo import shape:

```ts
import { LLMRequest, LLMEvent, LLMClient } from "@opencode-ai/llm"
```

Until it becomes a package, this can live under `packages/opencode/src/llm-core`
with the same module boundaries.

### Module responsibilities

Keep module boundaries strict so the package stays portable.

- `schema.ts` owns public domain schemas, constructors, branded IDs, and typed
  errors. It should not import provider modules.
- `adapter.ts` owns adapter interfaces, adapter registry helpers, and the shared
  adapter execution pipeline.
- `target.ts` owns target fragments, draft validation helpers, and target
  redaction helpers for tests/errors. Slot merge laws can be added when a real
  adapter needs fragment conflict handling.
- `patch.ts` owns patch definitions, deterministic selection/sorting, patch
  plans, and trace generation.
- `transport.ts` owns injectable HTTP transport and transport errors. It should
  not parse provider event streams.
- `stream.ts` owns byte/SSE/line parsing utilities and provider chunk decoding
  helpers.
- `tool-runtime.ts` owns the optional tool execution loop. Provider adapters do
  not call tools directly.
- `provider/*` owns protocol-specific target schemas, lowerers, chunk schemas,
  chunk-to-event raising, and default protocol patches.
- `patch/*` owns reusable named patches that are not tied to one adapter file.

If the first version lands under `packages/opencode/src/llm-core`, each module
should follow the repo's self-export pattern, for example:

```ts
export class Service extends Context.Service<Service, Interface>()("@opencode/LLMCore") {}

export * as LLMCore from "./client"
```

The standalone package can expose a package-level `index.ts` later, but internal
multi-sibling directories should avoid broad barrels.

## Public API

The primary consumer-facing surface should be small.

```ts
export interface LLMClient {
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError>
}
```

`stream` is the primitive. `prepare` is for tests and debugging. `generate` is a
convenience that consumes the stream and accumulates a final response.

The package should also expose lower-level APIs for tests and advanced callers:

```ts
export interface LLMCompiler {
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
}

export interface AdapterRegistry {
  readonly resolve: (model: ModelRef) => Effect.Effect<AnyAdapter, LLMError>
}
```

Recommended construction API:

```ts
export interface ClientOptions {
  readonly adapters: AdapterRegistry
  readonly transport: Transport
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
  readonly clock?: Clock.Clock
}

export const client: (options: ClientOptions) => Effect.Effect<LLMClient, LLMError>
```

Consumer-side opencode code should be this small:

```ts
const llm = yield* LLMCore.client({
  adapters: AdapterRegistry.make([
    OpenAIChat.adapter,
    OpenAIResponses.adapter,
    Anthropic.adapter,
    Gemini.adapter,
  ]),
  transport: Transport.fetch,
  patches: OpenCodePatches.default,
})

return llm.stream(request)
```

Debugging should not require knowing the patch planner API:

```ts
const prepared = yield* llm.prepare(request)

log.info("llm prepared", {
  adapter: prepared.adapter,
  target: prepared.redactedTarget,
  patches: prepared.patchTrace,
})
```

When embedded in opencode, also expose an Effect service wrapper so runtime
wiring can use layers without forcing standalone consumers to do the same:

```ts
export interface Interface extends LLMClient {}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLMCore") {}
```

`client` should be the implementation primitive. The service layer should be thin
wiring around that primitive.

### Prepared requests

Tests and debugging need visibility into the compiled provider target before the
network request is sent.

```ts
export class PreparedRequest extends Schema.Class<PreparedRequest>("LLM.PreparedRequest")({
  id: Schema.String,
  adapter: Schema.String,
  model: ModelRef,
  target: Schema.Unknown,
  redactedTarget: Schema.Unknown,
  transport: TransportRequest,
  patchTrace: Schema.Array(PatchTrace),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

`target` is adapter-typed at compile time but erased here for registries and
debugging. The adapter should provide `redact(target)` so tests can snapshot
headers/body safely and provider errors can include useful context without
leaking secrets.

`LLMCompiler.prepare` should stop before transport I/O. `LLMClient.stream`
should be equivalent to `prepare` plus `transport.fetch` plus `parse` plus
`raise`.

## Common schemas

Effect Schema should own the package's public data model.

### Model reference

The package should receive a resolved model reference. It should not load config
or credentials itself.

```ts
export const Protocol = Schema.Literals([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini",
  "bedrock-converse",
])

export class ModelRef extends Schema.Class<ModelRef>("LLM.ModelRef")({
  id: Schema.String,
  provider: Schema.String,
  protocol: Protocol,
  baseURL: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  capabilities: ModelCapabilities,
  limits: ModelLimits,
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

`native` is the typed escape hatch for model facts that the package should pass
to adapter patches without standardizing globally.

### Capabilities

Capabilities answer whether a model can do something. Patches answer how to make
it do that thing.

```ts
export class ModelCapabilities extends Schema.Class<ModelCapabilities>("LLM.ModelCapabilities")({
  input: Schema.Struct({
    text: Schema.Boolean,
    image: Schema.Boolean,
    audio: Schema.Boolean,
    video: Schema.Boolean,
    pdf: Schema.Boolean,
  }),
  output: Schema.Struct({
    text: Schema.Boolean,
    reasoning: Schema.Boolean,
  }),
  tools: Schema.Struct({
    calls: Schema.Boolean,
    streamingInput: Schema.Boolean,
    providerExecuted: Schema.Boolean,
  }),
  cache: Schema.Struct({
    prompt: Schema.Boolean,
    messageBlocks: Schema.Boolean,
    contentBlocks: Schema.Boolean,
  }),
  reasoning: Schema.Struct({
    efforts: Schema.Array(ReasoningEffort),
    summaries: Schema.Boolean,
    encryptedContent: Schema.Boolean,
  }),
}) {}
```

### Request

`LLMRequest` is intent, not a provider request.

```ts
export class LLMRequest extends Schema.Class<LLMRequest>("LLM.Request")({
  id: Schema.optional(Schema.String),
  model: ModelRef,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: GenerationOptions,
  reasoning: Schema.optional(ReasoningIntent),
  cache: Schema.optional(CacheIntent),
  responseFormat: Schema.optional(ResponseFormat),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

`native` is request-scoped adapter input. It can carry data like routing hints,
provider-specific flags, or user-supplied extension values. It should not be
blindly merged into provider requests. Adapters and config patches must decide
where it is allowed to go.

### Messages

Messages should represent model conversation history independently from any UI
or persistence format.

```ts
export const MessageRole = Schema.Literals(["user", "assistant", "tool"])

export class Message extends Schema.Class<Message>("LLM.Message")({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

System content is separate so adapters can lower it naturally. OpenAI Responses
can use `instructions`; Anthropic can use `system`; OpenAI Chat can prepend
system messages.

```ts
export class SystemPart extends Schema.Class<SystemPart>("LLM.SystemPart")({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

### Content parts

Content parts should be the smallest stable shared vocabulary.

```ts
export class TextPart extends Schema.Class<TextPart>("LLM.Content.Text")({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class MediaPart extends Schema.Class<MediaPart>("LLM.Content.Media")({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8ArrayFromSelf]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class ToolCallPart extends Schema.Class<ToolCallPart>("LLM.Content.ToolCall")({
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class ToolResultPart extends Schema.Class<ToolResultPart>("LLM.Content.ToolResult")({
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: ToolResult,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class ReasoningPart extends Schema.Class<ReasoningPart>("LLM.Content.Reasoning")({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export const ContentPart = Schema.Union([
  TextPart,
  MediaPart,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
])
```

The package should avoid UI-specific concepts like synthetic parts, ignored
parts, compaction parts, patch parts, or subtask parts. Consumers translate
those into this IR before calling the package.

### Tools

Tool definitions should support both schema-only tools and executable tools.

```ts
export class ToolDefinition extends Schema.Class<ToolDefinition>("LLM.ToolDefinition")({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export interface ExecutableTool extends Schema.Schema.Type<typeof ToolDefinition> {
  readonly execute: (input: unknown, context: ToolContext) => Effect.Effect<ToolResult, LLMError>
}
```

The core adapter only needs `ToolDefinition`. The optional `ToolRuntime` can use
`ExecutableTool` to execute calls and feed results back into a loop.

### Events

`LLMEvent` is the package's stable output stream.

```ts
export const LLMEvent = Schema.Union([
  RequestStart,
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolCall,
  ToolResult,
  ToolError,
  StepFinish,
  RequestFinish,
  ProviderErrorEvent,
])
```

Minimum event set:

- `request-start`
- `step-start`
- `text-start`
- `text-delta`
- `text-end`
- `reasoning-start`
- `reasoning-delta`
- `reasoning-end`
- `tool-input-start`
- `tool-input-delta`
- `tool-input-end`
- `tool-call`
- `tool-result`
- `tool-error`
- `step-finish`
- `request-finish`
- `provider-error`

The event names do not need to match AI SDK. They need to be stable,
schema-backed, and sufficient for consumers to update state.

### Usage

Usage should normalize common token facts without hiding provider metadata.

```ts
export class Usage extends Schema.Class<Usage>("LLM.Usage")({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
```

Consumers own cost calculation because pricing is product-specific.

## Adapter contract

Adapters are protocol interpreters. They lower `LLMRequest` into a target draft,
validate the final target, convert it to transport, decode chunks, and raise
events.

```ts
export interface Adapter<Draft, Target, Chunk> {
  readonly id: string
  readonly protocol: Schema.Schema.Type<typeof Protocol>
  readonly targetSchema: Schema.Schema<Target>
  readonly chunkSchema: Schema.Schema<Chunk>
  readonly builder: TargetBuilder<Draft, Target>
  readonly patches: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown

  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly toTransport: (target: Target, context: TransportContext) => Effect.Effect<TransportRequest, LLMError>
  readonly parse: (response: Response) => Stream.Stream<Chunk, LLMError>
  readonly raise: (chunk: Chunk, state: RaiseState) => Stream.Stream<LLMEvent, LLMError>
}
```

Adapter modules should expose typed helpers so target patches do not lose their
draft type:

```ts
export const OpenAIChat = Adapter.define({
  id: "openai-chat",
  protocol: "openai-chat",
  target: OpenAIChatRequest,
  chunk: OpenAIChatChunk,
  builder,
  prepare,
  toTransport,
  parse,
  raise,
})

export const includeUsage = OpenAIChat.patch("include-usage", {
  reason: "OpenAI-compatible streams omit usage unless requested",
  when: Model.protocol("openai-chat"),
  apply: (draft) => ({
    ...draft,
    stream_options: {
      ...draft.stream_options,
      include_usage: true,
    },
  }),
})

export const adapter = OpenAIChat.withPatches([includeUsage, gpt5Defaults])
```

The package can erase adapter generics for registries:

```ts
export interface AnyAdapter {
  readonly id: string
  readonly protocol: Schema.Schema.Type<typeof Protocol>
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
}
```

`send` is intentionally not adapter-local. The shared client should own transport
so retries, timeouts, cancellation, tracing, and test transports are consistent.
Adapters should only convert a validated target into a `TransportRequest`.

### Adapter execution flow

The shared adapter runner should be boring and testable.

```text
request
  -> decode LLMRequest
  -> build PatchContext
  -> apply request/prompt/tool-schema patches
  -> resolve adapter from ModelRef.protocol
  -> adapter.prepare(request) -> Draft
  -> apply adapter default target patches
  -> apply registry target patches
  -> TargetBuilder.validate(draft) -> Target
  -> adapter.toTransport(target) -> TransportRequest
  -> transport.fetch(transportRequest) -> Response
  -> adapter.parse(response) -> Chunk stream
  -> decode each Chunk with adapter.chunkSchema
  -> adapter.raise(chunk, state) -> LLMEvent stream
  -> decode each LLMEvent
```

`prepare` should expose the flow through target validation. `stream` should run
the full flow. Unit tests should exercise each step directly, and contract tests
should exercise the whole flow with an in-memory transport.

## Target construction

Provider target output should be composable but typed.

The key split is `Draft` vs `Target`.

```ts
export interface TargetBuilder<Draft, Target> {
  readonly empty: Draft
  readonly concat: (left: Draft, right: Draft) => Draft
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
}
```

`Draft` can be partial and adapter-local. `Target` is the final
Schema-validated request.

Fragments describe small writes into a draft.

```ts
export interface TargetFragment<Draft> {
  readonly id: string
  readonly slot: TargetSlot
  readonly reason: string
  readonly apply: (draft: Draft) => Draft
}
```

Slots describe semantic ownership.

```ts
export const TargetSlot = Schema.Literals([
  "model",
  "system",
  "messages",
  "tools",
  "tool-choice",
  "generation",
  "reasoning",
  "cache",
  "response-format",
  "headers",
  "extensions",
])
```

Adapter builders decide merge behavior for each slot.

- `messages` usually appends.
- `tools` usually appends by tool name and rejects duplicates.
- `generation` usually last-write-wins by field.
- `reasoning` may reject conflicting efforts.
- `headers` usually case-insensitive merges.
- `extensions` can deep-merge only into adapter-declared extension objects.

Example OpenAI-compatible draft fragment:

```ts
const includeUsage: TargetFragment<OpenAIChatDraft> = {
  id: "request.openai-chat.include-usage",
  slot: "generation",
  reason: "OpenAI-compatible streams often omit usage unless requested",
  apply: (draft) => ({
    ...draft,
    stream_options: {
      ...draft.stream_options,
      include_usage: true,
    },
  }),
}
```

This gives target output a composable shape without making the target a generic
JSON Patch document.

## Patch system

Patches are named, typed transformations over either domain request data or
adapter drafts.

```ts
export const PatchPhase = Schema.Literals([
  "request",
  "prompt",
  "tool-schema",
  "target",
  "transport",
  "stream",
])

export interface PatchContext {
  readonly request: LLMRequest
  readonly model: ModelRef
  readonly protocol: Schema.Schema.Type<typeof Protocol>
  readonly small: boolean
  readonly flags: Record<string, string | number | boolean | undefined>
}

export interface Patch<A> {
  readonly id: string
  readonly phase: Schema.Schema.Type<typeof PatchPhase>
  readonly reason: string
  readonly order?: number
  readonly when: (context: PatchContext) => boolean
  readonly apply: (value: A, context: PatchContext) => A
}
```

Example prompt patch:

```ts
export const removeAnthropicEmptyContent = Patch.prompt("anthropic.remove-empty-content", {
  reason: "Anthropic-compatible APIs reject empty text/reasoning content blocks",
  when: Model.protocol("anthropic-messages").or(Model.provider("bedrock")),
  apply: (request) => ({
    ...request,
    messages: request.messages
      .map((message) => ({
        ...message,
        content: message.content.filter((part) => {
          if (part.type === "text" || part.type === "reasoning") return part.text !== ""
          return true
        }),
      }))
      .filter((message) => message.content.length > 0),
  }),
})
```

Raw patch objects are the internal representation. Patch authors should normally
use phase-specific constructors so phase and ID prefix are consistent:

```ts
export const Patch = {
  request: <A extends LLMRequest>(id: string, input: PatchInput<A>) =>
    makePatch(`request.${id}`, "request", input),
  prompt: <A extends LLMRequest>(id: string, input: PatchInput<A>) =>
    makePatch(`prompt.${id}`, "prompt", input),
  toolSchema: <A extends ToolDefinition>(id: string, input: PatchInput<A>) =>
    makePatch(`schema.${id}`, "tool-schema", input),
  transport: <A extends TransportRequest>(id: string, input: PatchInput<A>) =>
    makePatch(`transport.${id}`, "transport", input),
  stream: <A extends LLMEvent>(id: string, input: PatchInput<A>) =>
    makePatch(`stream.${id}`, "stream", input),
}
```

Adapter target patches should be constructed by the adapter module so their draft
type is preserved:

```ts
export const includeUsage = OpenAIChat.patch("include-usage", {
  reason: "OpenAI-compatible streams omit usage unless requested",
  when: Model.protocol("openai-chat"),
  apply: (draft) => ({
    ...draft,
    stream_options: {
      ...draft.stream_options,
      include_usage: true,
    },
  }),
})
```

`when` should read like model/request policy, not ad hoc boolean plumbing:

```ts
export const Model = {
  provider: (provider: string): PatchPredicate => (ctx) => ctx.model.provider === provider,
  protocol: (protocol: Protocol): PatchPredicate => (ctx) => ctx.protocol === protocol,
  idIncludes: (value: string): PatchPredicate => (ctx) => ctx.model.id.toLowerCase().includes(value),
  capable: (capability: ModelCapabilityPath): PatchPredicate => (ctx) => getCapability(ctx.model, capability),
}

export const Request = {
  small: (): PatchPredicate => (ctx) => ctx.small,
  flag: (name: string): PatchPredicate => (ctx) => ctx.flags[name] === true,
}
```

Predicates should compose:

```ts
when: Model.provider("mistral").or(Model.idIncludes("devstral"))
```

Patch registries should accept flat patch lists and group by phase internally.
This keeps the call site nicer than hand-maintaining buckets.

```ts
export const defaultPatches = Patch.registry([
  removeAnthropicEmptyContent,
  splitAnthropicToolCalls,
  normalizeMistralToolCallIds,
  insertMistralAssistantBetweenToolAndUser,
  Gemini.sanitizeJsonSchema,
])
```

Internally, registries group patches by phase but stay adapter-agnostic.

```ts
export interface PatchRegistry {
  readonly request: ReadonlyArray<Patch<LLMRequest>>
  readonly prompt: ReadonlyArray<Patch<LLMRequest>>
  readonly toolSchema: ReadonlyArray<Patch<ToolDefinition>>
  readonly target: ReadonlyArray<Patch<unknown>>
  readonly transport: ReadonlyArray<Patch<TransportRequest>>
  readonly stream: ReadonlyArray<Patch<LLMEvent>>
}
```

Recommended opencode layout:

```text
src/llm-core/
  patch.ts
  patches/
    prompt.ts           # shared history/request compatibility patches
    schema.ts           # shared tool/JSON schema transforms
    transport.ts        # shared header/routing patches
    index.ts            # OpenCodePatches.default
  provider/
    openai-chat.ts      # adapter + typed OpenAI target patches
    anthropic.ts        # adapter + typed Anthropic target patches
    gemini.ts           # adapter + typed Gemini target patches
```

Normal opencode code should import only the final registry:

```ts
export const defaultPatches = Patch.registry([
  ...PromptPatches.default,
  ...SchemaPatches.default,
  ...TransportPatches.default,
])
```

Provider adapter modules should keep provider-native target patches close to the
target schema they mutate.

The `unknown` target phase is only for registry storage. Before application, the
shared runner should narrow target patches through the resolved adapter so target
patches remain typed at their definition sites.

Patches must be traceable.

```ts
export class PatchTrace extends Schema.Class<PatchTrace>("LLM.PatchTrace")({
  id: Schema.String,
  phase: PatchPhase,
  reason: Schema.String,
}) {}
```

Patch rules:

- A patch does one thing.
- A patch declares one phase.
- A patch has a stable ID.
- A patch has a human-readable reason.
- A patch is pure unless it is explicitly a transport patch.
- A patch is covered by fixture or unit tests.
- A patch trace is attached to provider request errors.

## Patch algebra

A patch is an endomorphism plus selection metadata:

```text
Patch<A> ~= PatchContext -> Option<Endo<A>>
Endo<A>  ~= A -> A
```

For a fixed `PatchContext`, selected patches compose like ordinary functions:

```text
apply([p1, p2, p3], a) = p3(p2(p1(a)))
```

This gives each phase an ordered monoid:

- Identity is the empty patch list.
- Composition is list concatenation followed by deterministic sorting.
- Associativity comes from function composition.
- The operation is not commutative; order is part of the semantics.

The practical API should make that explicit:

```ts
export interface PatchPlan<A> {
  readonly phase: Schema.Schema.Type<typeof PatchPhase>
  readonly patches: ReadonlyArray<Patch<A>>
  readonly trace: ReadonlyArray<PatchTrace>
  readonly apply: (value: A) => A
}

export const plan = <A>(input: {
  readonly phase: Schema.Schema.Type<typeof PatchPhase>
  readonly context: PatchContext
  readonly patches: ReadonlyArray<Patch<A>>
}): PatchPlan<A> => {
  // filter by `when`, then sort by phase/order/id, then compose apply fns
}
```

If patches can fail, the same shape becomes Kleisli composition:

```text
Patch<A> ~= PatchContext -> Option<A -> Effect<A, PatchError>>
```

Most patches should stay pure. Failure should be reserved for conflict detection,
invalid config patches, or target builders rejecting impossible combinations.

### Fragment algebra

Target fragments are a second algebra layered under target patches.

```text
TargetFragment<Draft> ~= Draft -> Draft
```

Fragments also compose as endomorphisms, but they carry a `slot` so builders can
apply slot-specific merge rules. This lets the package avoid global deep-merge
semantics.

Slots should use explicit semigroups:

- `set-once`: write once, reject a second different value.
- `last-write-wins`: deterministic override for scalar generation fields.
- `append`: append ordered content such as messages or content blocks.
- `append-keyed`: append by key and reject duplicates, useful for tools.
- `deep-merge`: only for declared extension objects.
- `reject`: conflicts are errors, useful for incompatible reasoning policies.

Example slot merge table:

```ts
export const OpenAIChatSlots = {
  model: Slot.setOnce,
  messages: Slot.append,
  tools: Slot.appendKeyed((tool) => tool.function.name),
  generation: Slot.lastWriteWins,
  reasoning: Slot.rejectOnConflict,
  headers: Slot.caseInsensitiveMerge,
  extensions: Slot.deepMerge,
}
```

This is the main composability point: patches do not need to know how the whole
provider request is merged. They only contribute typed fragments to semantic
slots, and the adapter builder owns the algebra for those slots.

### Patch laws

Patches should satisfy these laws unless a comment explains why not:

- Determinism: same input and context produce the same output and trace.
- Locality: a patch only touches its declared phase or slot.
- Idempotence: applying the same patch twice should usually be equivalent to
  applying it once.
- Monotonic trace: if a patch changes output, it emits exactly one trace entry.
- Validation boundary: final target validation happens after all patches for a
  target have run.
- No hidden I/O: request, prompt, schema, and target patches are pure.

Idempotence is especially useful for model quirks. A patch like
`target.openai-chat.include-usage` should set `include_usage: true`, not append a
second usage directive. Non-idempotent patches should be rare and ordered close
to the adapter lowerer that needs them.

### Why not JSON Patch

JSON Patch is too untyped for core behavior. It composes at the path level, but
provider request semantics are not just paths. `tools`, `messages`, `headers`,
`reasoning`, and `extensions` all have different merge laws.

The package can still support config-provided patch-like data, but only by
decoding it into typed fragments for adapter-declared slots.

## Model quirks as patches

Current weird behavior should become named patches, not scattered branches.

Prompt patches:

- `prompt.unsupported-media`
- `prompt.anthropic.remove-empty-content`
- `prompt.claude.scrub-tool-call-ids`
- `prompt.anthropic.reorder-tool-calls`
- `prompt.mistral.scrub-tool-call-ids`
- `prompt.mistral.insert-assistant-between-tool-and-user`
- `prompt.deepseek.ensure-assistant-reasoning`
- `prompt.interleaved-reasoning-to-native-field`

Tool/schema patches:

- `schema.gemini.sanitize-json-schema`
- `tools.litellm.noop-tool-for-history`
- `tools.github-copilot.noop-tool-for-history`

Request/target patches:

- `target.openai.store-false`
- `target.azure.store-true`
- `target.openai-chat.include-usage`
- `target.baseten.enable-thinking-template`
- `target.zai.enable-thinking`
- `target.alibaba-cn.enable-thinking`
- `target.gemini.thinking-config`
- `target.gpt5.defaults`
- `target.opencode.gpt5-cache-and-reasoning`
- `target.venice.prompt-cache-key`
- `target.openrouter.prompt-cache-key`
- `target.gateway.caching-auto`

Small-request patches:

- `target.small.openai-gpt5-reasoning-low`
- `target.small.gemini-disable-thinking`
- `target.small.openrouter-disable-reasoning`
- `target.small.venice-disable-thinking`

These patch IDs can start internal. If config later references them, they become
public API and need stability rules.

## Reasoning

Reasoning should be common intent plus adapter-local lowering.

```ts
export const ReasoningEffort = Schema.Literals([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

export class ReasoningIntent extends Schema.Class<ReasoningIntent>("LLM.ReasoningIntent")({
  enabled: Schema.Boolean,
  effort: Schema.optional(ReasoningEffort),
  summary: Schema.optional(Schema.Boolean),
  encryptedContent: Schema.optional(Schema.Boolean),
}) {}
```

Adapter lowerers own native output:

- OpenAI Responses lowers to `reasoning`, `include`, and text verbosity fields.
- OpenAI Chat-compatible lowers to `reasoningEffort` or extension body fields.
- Anthropic lowers to `thinking` with budget or adaptive effort.
- Gemini lowers to `thinkingConfig` with level or budget.
- Bedrock lowers to `reasoningConfig`.
- OpenRouter lowers to upstream-specific reasoning objects.

The package should not pretend these are the same field. They are one intent
with multiple target interpretations.

## Structured output

Structured output should be an intent, with adapter strategies.

```ts
export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("json"), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal("tool"), tool: ToolDefinition }),
])
```

Strategies:

- Use native JSON schema when the adapter and model support it.
- Use forced tool call when native JSON schema is unreliable.
- Use text JSON as a last resort only when explicitly requested.

The strategy should be selected by adapter capability plus patches, not by
consumer code.

## Tool runtime

The base package can stream tool calls without executing them. A helper runtime
can orchestrate execution for consumers that want AI SDK-like tool loops.

```ts
export interface ToolRuntime {
  readonly run: (request: LLMRequest, tools: ReadonlyArray<ExecutableTool>) => Stream.Stream<LLMEvent, LLMError>
}
```

Runtime behavior:

- Send the request through `LLMClient.stream`.
- Accumulate partial tool input events.
- Execute matching tools when `tool-call` is complete.
- Emit `tool-result` or `tool-error` events.
- Append tool result messages and continue when the finish reason is tool calls.
- Stop when the adapter emits a terminal finish reason or max steps is reached.

This keeps adapters focused on protocols and keeps tool execution policy
optional.

## Transport

Transport should be injectable.

```ts
export interface Transport {
  readonly fetch: (request: TransportRequest) => Effect.Effect<Response, LLMError>
}

export class TransportRequest extends Schema.Class<TransportRequest>("LLM.TransportRequest")({
  url: Schema.String,
  method: Schema.Literal("POST"),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
}) {}
```

The default transport can use `fetch`. Consumers can inject tracing, retries,
timeouts, auth refresh, request logging, or test transports.

## Errors

Errors should be domain-specific and schema-backed.

```ts
export class NoAdapterError extends Schema.TaggedErrorClass<NoAdapterError>()("LLM.NoAdapterError", {
  protocol: Protocol,
  provider: Schema.String,
  model: Schema.String,
}) {}

export class TargetValidationError extends Schema.TaggedErrorClass<TargetValidationError>()(
  "LLM.TargetValidationError",
  {
    adapter: Schema.String,
    message: Schema.String,
    patchTrace: Schema.Array(PatchTrace),
  },
) {}

export class ProviderRequestError extends Schema.TaggedErrorClass<ProviderRequestError>()(
  "LLM.ProviderRequestError",
  {
    adapter: Schema.String,
    provider: Schema.String,
    model: Schema.String,
    status: Schema.optional(Schema.Number),
    message: Schema.String,
    body: Schema.optional(Schema.String),
    patchTrace: Schema.Array(PatchTrace),
  },
) {}

export class ProviderChunkError extends Schema.TaggedErrorClass<ProviderChunkError>()(
  "LLM.ProviderChunkError",
  {
    adapter: Schema.String,
    message: Schema.String,
    raw: Schema.optional(Schema.String),
  },
) {}
```

Patch traces on request and validation errors are critical. They turn provider
400s into debuggable failures.

## Testing model

Most package tests should be pure transformation and stream parser tests.

Test types:

- request schema decoding
- target schema validation
- prompt lowering fixtures
- target fragment merge behavior
- patch selection and trace output
- provider chunk decoding from captured fixtures
- provider chunk raising into `LLMEvent`
- tool runtime loop with in-memory executable tools
- one optional integration test per protocol behind env vars

Provider fixtures should include:

- text-only stream
- reasoning stream
- partial tool input stream
- complete tool call stream
- usage-only final chunk
- provider error payload
- malformed chunk

## Existing tests to mine

The sibling repos already exist locally:

- `../ai` is the Vercel AI SDK repository.
- `../pi-mono` has a focused `packages/ai` package with many provider edge-case
  tests.

These tests should be treated as fixture and behavior inspiration, not copied
verbatim unless licenses and dependency assumptions are checked. The valuable
thing to steal is the case matrix: inputs, provider chunks, expected lowered
targets, and expected event sequences.

High-value `../ai` tests:

- `../ai/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.test.ts`
  for OpenAI-compatible message lowering, images, tool calls, tool results, and
  provider metadata merging.
- `../ai/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.test.ts`
  for OpenAI-compatible request bodies, reasoning fields, usage extraction,
  stream parsing, tool calls, and response metadata.
- `../ai/packages/openai/src/chat/convert-to-openai-chat-messages.test.ts` for
  OpenAI Chat message lowering differences from OpenAI-compatible.
- `../ai/packages/openai/src/chat/openai-chat-language-model.test.ts` for OpenAI
  Chat request/stream behavior and finish reason handling.
- `../ai/packages/openai/src/responses/convert-to-openai-responses-input.test.ts`
  for OpenAI Responses input lowering, system message modes, images, files,
  tool calls, and item shapes.
- `../ai/packages/openai/src/responses/openai-responses-language-model.test.ts`
  for Responses stream chunks, usage, reasoning, tool calls, and provider
  metadata.
- `../ai/packages/anthropic/src/convert-to-anthropic-messages-prompt.test.ts`
  for Anthropic system lowering, images, PDFs, text files, tool calls, tool
  results, reasoning, cache control, and beta header implications.
- `../ai/packages/google/src/convert-to-google-generative-ai-messages.test.ts`
  for Gemini content lowering, system instruction handling, thought signatures,
  function calls, and media parts.
- `../ai/packages/google/src/convert-json-schema-to-openapi-schema.test.ts` for
  Gemini/OpenAPI schema sanitation cases.
- `../ai/packages/ai/src/generate-text/parse-tool-call.test.ts` for tool input
  parsing, empty inputs, unknown tools, invalid inputs, and repair behavior.
- `../ai/packages/ai/src/generate-text/run-tools-transformation.test.ts` for an
  optional tool runtime loop over a model stream.
- `../ai/packages/ai/src/generate-text/stream-text.test.ts` for high-level stream
  event sequencing and finish behavior.
- `../ai/packages/ai/src/util/parse-partial-json.test.ts` and
  `../ai/packages/ai/src/util/fix-json.test.ts` for partial tool argument
  parsing during streaming.

High-value `../pi-mono` tests:

- `../pi-mono/packages/ai/test/stream.test.ts` for live/e2e behavior across text,
  tools, streaming text, thinking, media, and provider families.
- `../pi-mono/packages/ai/test/openai-codex-stream.test.ts` for OpenAI Responses
  SSE fixtures, terminal events, incomplete responses, and streams that remain
  open after completion.
- `../pi-mono/packages/ai/test/tool-call-id-normalization.test.ts` for long
  OpenAI Responses/Copilot tool call IDs handed off to stricter providers.
- `../pi-mono/packages/ai/test/transform-messages-copilot-openai-to-anthropic.test.ts`
  for cross-provider history conversion into Anthropic-compatible shapes.
- `../pi-mono/packages/ai/test/tool-call-without-result.test.ts` for histories
  that contain tool calls without active tool results.
- `../pi-mono/packages/ai/test/openai-responses-tool-result-images.test.ts` and
  `../pi-mono/packages/ai/test/openai-completions-tool-result-images.test.ts` for
  tool result media routing.
- `../pi-mono/packages/ai/test/image-tool-result.test.ts` for provider-specific
  image handling in tool results.
- `../pi-mono/packages/ai/test/interleaved-thinking.test.ts` for reasoning mixed
  with normal assistant content.
- `../pi-mono/packages/ai/test/openai-responses-foreign-toolcall-id.test.ts` for
  foreign tool-call IDs in OpenAI Responses histories.
- `../pi-mono/packages/ai/test/google-thinking-signature.test.ts` for preserving
  Gemini thought signatures.
- `../pi-mono/packages/ai/test/google-tool-call-missing-args.test.ts` for Gemini
  tool calls with missing/empty args.
- `../pi-mono/packages/ai/test/google-shared-gemini3-unsigned-tool-call.test.ts`
  for Gemini 3 unsigned tool calls.
- `../pi-mono/packages/ai/test/google-thinking-disable.test.ts` for disabling
  thinking on small or non-reasoning calls.
- `../pi-mono/packages/ai/test/openrouter-cache-write-repro.test.ts` and
  `../pi-mono/packages/ai/test/cache-retention.test.ts` for prompt/cache control
  edge cases.
- `../pi-mono/packages/ai/test/tokens.test.ts`,
  `../pi-mono/packages/ai/test/total-tokens.test.ts`, and
  `../pi-mono/packages/ai/test/overflow.test.ts` for usage normalization and
  context overflow behavior.
- `../pi-mono/packages/ai/test/abort.test.ts` for cancellation semantics.
- `../pi-mono/packages/ai/test/empty.test.ts` and
  `../pi-mono/packages/ai/test/unicode-surrogate.test.ts` for malformed/edge
  content.

Suggested mining order for the MVP:

1. Start with AI SDK pure lowering tests for OpenAI-compatible and OpenAI
   Responses. Convert their inputs into `LLMRequest` fixtures and snapshots into
   provider target snapshots.
2. Use AI SDK stream/model tests to build provider chunk fixtures for OpenAI
   Chat and Responses.
3. Use Pi tests for regression cases AI SDK does not cover, especially
   cross-provider handoff, tool ID normalization, media in tool results,
   reasoning signatures, and cache behavior.
4. Keep live/e2e tests optional behind env vars. The package's required test
   suite should be deterministic and fixture-based.

## Prior art

### AI SDK

AI SDK's provider architecture is mature and worth studying. It is not "bad"
code, but it is shaped by a broad public API, browser/server use cases, UI
helpers, provider package compatibility, telemetry, callbacks, retries, tools,
and legacy evolution. That makes the code heavier than what this package should
start with.

Useful ideas to borrow:

- A narrow provider interface. `LanguageModelV3` has `doGenerate` and
  `doStream`, plus provider/model identity and supported URL metadata.
- A standardized provider prompt separate from user-facing prompt inputs.
- A standardized stream-part union with text, reasoning, tool input, tool calls,
  files, sources, metadata, finish, raw, and error parts.
- Provider-specific request lowering isolated in provider packages.
- Tool preparation separated from tool execution.
- Tool execution as a stream transformation that can delay finish until tool
  results are emitted.
- Test-server and fixture-heavy provider tests.
- Explicit `providerOptions` and `providerMetadata` escape hatches.
- Stream parts for partial tool input, not just final tool calls.

Things to avoid copying directly:

- A very large `streamText` orchestration surface that mixes prompt
  standardization, retries, telemetry, callbacks, tool loops, result promises,
  UI streams, and output parsing.
- User-facing UI message concerns in the core model package.
- Wide provider option bags as the main extensibility mechanism.
- Heavy overload/type gymnastics for public SDK ergonomics before the internal
  algebra is stable.
- Direct `ReadableStream`-first internals when Effect `Stream` can keep errors,
  interruption, scope, and services explicit.

The best AI SDK lesson is: keep the provider contract small, but expect the
orchestration layer to grow if tool execution, UI streams, callbacks, retries,
and structured output all live in one function. This package should split those
concerns from the beginning.

### Effect Smol unstable AI

Effect Smol's `effect/unstable/ai` modules are closer to the desired shape.
Relevant files live under `../effect-smol/packages/effect/src/unstable/ai`.

Useful ideas to borrow:

- `Prompt` and `Response` are Schema-owned domain models with encoded and
  decoded representations.
- `Tool` and `Toolkit` use Schema for parameters, success, and failure outputs,
  then decode inputs and encode outputs at execution boundaries.
- `LanguageModel.make` separates provider implementations from higher-level
  generation and stream orchestration.
- `Response.StreamPart(toolkit)` builds a stream-part schema that is specialized
  by the active toolkit.
- `disableToolCallResolution` makes tool execution optional instead of forcing
  one runtime policy.
- `CodecTransformer` is exactly the right abstraction for provider-specific
  structured-output schema rewriting.
- `OpenAiStructuredOutput` and `AnthropicStructuredOutput` show how to transform
  Effect Schema ASTs while preserving decoded types.
- `ResponseIdTracker` is a small focused service for incremental prompts and
  previous response IDs.
- Tests use `withLanguageModel(...)` to inject fake model services without
  mocking the whole world.

Things to avoid copying directly:

- The high-level `LanguageModel` and `Chat` APIs are broad application APIs, not
  just a provider adapter core.
- Some type-level machinery is optimized for public Effect ergonomics and may be
  too heavy for a first prototype.
- The unstable AI modules do not solve all provider-native lowering and patch
  needs; they provide a strong domain/runtime shape, not a full replacement for
  provider adapters.

Most important Effect Smol inspiration: schemas should be executable contracts,
not documentation. Prompt parts, response parts, tool params/results, structured
output codecs, and provider chunks should all be decoded or encoded at explicit
boundaries.

## Ideal testing strategy

The test suite should be a pyramid with deterministic tests at the base and a
small number of live provider tests at the top.

```text
many:     schema, lowering, patch, parser, event, property tests
some:     adapter contract tests with recorded chunks/responses
few:      live provider smoke tests behind env vars
rare:     cross-provider e2e handoff tests
```

### Unit and fixture tests

Most tests should be ordinary unit tests over pure data.

These are the core tests:

- Decode valid and invalid `LLMRequest` values with Effect Schema.
- Lower `LLMRequest` fixtures into provider target drafts.
- Validate drafts into provider target ASTs.
- Snapshot final redacted provider request bodies.
- Apply patch plans and snapshot patch traces.
- Decode provider stream chunks from captured fixtures.
- Raise decoded chunks into `LLMEvent` sequences.
- Normalize usage from provider payloads.
- Parse partial tool-call JSON into stable input events.
- Verify tool schema sanitation for providers like Gemini.
- Verify media routing for user input and tool results.

These tests should not hit the network. They should run fast and be safe in CI.

### Adapter contract tests

Every adapter should share the same contract test suite where possible.

Contract cases:

- text-only request lowers to valid target and emits text events
- tool-call request lowers tools and emits tool input/call events
- reasoning request emits reasoning events when chunks contain reasoning
- usage payload normalizes into `Usage`
- provider error payload normalizes into `ProviderRequestError` or
  `ProviderErrorEvent`
- malformed chunks produce `ProviderChunkError`
- terminal provider event ends the stream even if the body remains open
- aborting the stream interrupts parsing and transport cleanly

The contract suite can be parameterized by adapter:

```ts
runAdapterContractTests({
  name: "openai-chat",
  adapter: OpenAIChatAdapter,
  fixtures: OpenAIChatFixtures,
})
```

Adapter-specific tests still exist for native weirdness, but the shared contract
prevents every provider from inventing its own semantics.

### Property tests

Property tests help for algebra and parsing invariants. They are not a
replacement for provider fixtures because provider APIs have many arbitrary
rules. Use them where the property is ours.

Good property-test targets:

- Patch planning is deterministic regardless of input patch array order when
  `phase`, `order`, and `id` are fixed.
- Empty patch plan is identity.
- Patch-plan composition is associative for pure patches.
- Idempotent patches remain idempotent.
- Patch traces are stable and contain exactly the selected patches.
- Target builder `concat` is associative for slots that claim monoidal behavior.
- `append-keyed` rejects duplicate keys or keeps a deterministic winner,
  depending on the declared law.
- Header merge is case-insensitive.
- JSON schema sanitation is idempotent.
- Tool-call ID normalization always produces provider-legal IDs and avoids
  collisions for a generated corpus.
- SSE parser handles arbitrary chunk boundaries.
- Text/event streams split across arbitrary byte boundaries decode to the same
  event sequence as unsplit streams.
- Partial JSON parser never throws for arbitrary prefixes; it returns either a
  partial object, empty object, or typed parse error.

Libraries to consider:

- `fast-check` is the pragmatic TypeScript choice.
- Effect's test/schema tooling can help generate schema-shaped values if that
  becomes ergonomic enough locally.

Property tests to avoid:

- Do not generate arbitrary provider request bodies and assert provider behavior.
  The provider behavior is not algebraic and will produce noisy tests.
- Do not snapshot property-generated values. Assert laws and invariants instead.
- Do not make property tests depend on network calls.

### Golden fixture tests

Golden tests should cover provider-native inputs and outputs that are easy to
break accidentally.

Fixture layout:

```text
test/fixture/
  openai-chat/
    text.request.json
    text.stream.sse
    text.events.json
    tool-call.request.json
    tool-call.stream.sse
    tool-call.events.json
  openai-responses/
  anthropic/
  gemini/
```

Golden tests should store redacted provider requests and captured stream bodies,
not secrets or full live transcripts. When a provider changes, update fixtures
deliberately and keep a note about the upstream behavior change.

### Live integration tests

Live provider tests are useful but should be few, explicit, and optional.

Use live tests for:

- proving credentials/auth/headers work
- detecting provider API drift not represented in fixtures
- smoke-testing one text-only request per major protocol
- smoke-testing one tool-call request for OpenAI Chat, OpenAI Responses, and
  Anthropic
- validating cache/reasoning behavior that cannot be trusted from static
  fixtures

Live test rules:

- Skip unless the required env vars are present.
- Use cheap models and tiny prompts.
- Assert structural behavior, not exact wording.
- Use generous timeouts but keep the number of live tests small.
- Never run live tests in default PR CI unless explicitly configured.
- Record sanitized request/response fixtures from live tests when adding a new
  regression.

Example live test categories:

- `OPENAI_API_KEY`: OpenAI Chat text and tool call
- `OPENAI_RESPONSES_API_KEY`: Responses text, reasoning metadata if available
- `ANTHROPIC_API_KEY`: Anthropic text, tool call, cache metadata smoke
- `GOOGLE_API_KEY`: Gemini text and schema/tool smoke
- `OPENROUTER_API_KEY`: OpenAI-compatible proxy smoke

### Cross-provider tests

Cross-provider handoff is important for coding agents because histories can move
between models. These tests should mostly be deterministic fixtures.

Important cases:

- OpenAI Responses tool-call IDs replayed into OpenAI Chat-compatible providers.
- Copilot/OpenAI tool-call IDs replayed into Anthropic.
- Gemini thought signatures preserved when returning to Gemini.
- Tool results with images replayed into providers that do and do not support
  media in tool results.
- Reasoning content replayed into providers that require native reasoning fields.
- Histories with interrupted/pending tool calls converted into valid provider
  histories.

Only a very small subset of cross-provider tests should be live. Most should use
captured histories and assert target request validity.

### Mutation and differential tests

During migration from AI SDK, differential tests are valuable.

For providers still backed by AI SDK, compare:

- our lowered target request vs AI SDK lowered request where observable
- our event stream vs AI SDK full-stream event sequence for captured chunks
- our usage normalization vs AI SDK usage normalization

This does not mean copying AI SDK behavior forever. It gives us a migration
guardrail while replacing the abstraction.

Mutation-style checks can be simple:

- Remove a required patch from the selected patch set and assert a fixture fails
  target validation or violates an expected target snapshot.
- Corrupt a stream chunk and assert a typed chunk error.
- Remove a tool result from history and assert the prompt patch repairs or
  rejects the history according to protocol rules.

### What to optimize for

Prioritize tests that catch these failures:

- Provider 400s caused by subtly invalid message ordering.
- Tool call arguments streaming incorrectly or failing to parse partial JSON.
- Tool call IDs invalid for the next provider.
- Reasoning/thinking fields omitted or sent to the wrong native path.
- Cache-control metadata attached at the wrong level.
- Media routed into tool results for providers that reject it.
- Token usage double-counting cached or reasoning tokens.
- Streams hanging after a provider terminal event.
- Abort not cancelling transport or parser work.
- Config/native extension patches mutating undeclared target paths.

The ideal default suite is many deterministic tests plus property tests for our
own algebra. Live requests are a smoke/regression layer, not the main source of
confidence.

## MVP plan

### Phase 1: Package skeleton and schemas

Goal: define the standalone API without touching opencode runtime behavior.

1. Add `packages/llm` or `packages/opencode/src/llm-core` with no imports from
   opencode session modules.
2. Add `schema.ts` with `ModelRef`, `LLMRequest`, `Message`, `ContentPart`,
   `ToolDefinition`, `LLMEvent`, `Usage`, and errors.
3. Add `target.ts` with `TargetBuilder`, `TargetFragment`, and `TargetSlot`.
4. Add `patch.ts` with `Patch`, `PatchContext`, ordering, apply helpers, and
   traces.
5. Add schema decoding tests for valid and invalid requests/events.

Acceptance criteria:

- The package compiles independently.
- No session-specific types are imported.
- A consumer can construct and validate an `LLMRequest`.

### Phase 2: OpenAI Chat adapter without tool execution

Goal: prove lowering, target fragments, transport, SSE parsing, and event
raising for the simplest useful protocol.

1. Add `provider/openai-chat.ts` with `OpenAIChatDraft`, `OpenAIChatRequest`, and
   chunk schemas.
2. Lower system parts, messages, generation options, and tools into a draft.
3. Validate the draft into a provider target with Effect Schema.
4. Implement SSE parsing from `Response` to decoded chunks.
5. Raise chunks into text, tool-input, tool-call, usage, and finish events.
6. Test entirely from captured fixture chunks and target snapshots.

Acceptance criteria:

- A text-only fixture produces the expected `LLMEvent` sequence.
- A tool-call fixture assembles partial JSON input into one `tool-call` event.
- Target snapshots show provider-native OpenAI Chat payloads.

### Phase 3: Patch engine with real quirks

Goal: validate composability against known exceptions.

1. Implement prompt patches for unsupported media and empty content.
2. Implement schema patch for Gemini JSON Schema sanitation as a protocol-neutral
   schema transformer.
3. Implement target patches for OpenAI-compatible usage, Alibaba thinking, and
   GPT-5 defaults.
4. Attach patch traces to prepared requests and provider request errors.
5. Test patch selection against synthetic `ModelRef` fixtures.

Acceptance criteria:

- Patches can be selected by provider, protocol, model ID, capabilities, and
  request flags.
- Patch traces are deterministic and snapshot-tested.
- Conflicting fragments can be detected by the target builder.

### Phase 4: Optional tool runtime

Goal: prove the package can provide an AI SDK-like loop without forcing every
consumer to use it.

1. Add `tool-runtime.ts` with max step handling.
2. Execute `ExecutableTool`s when tool calls are emitted.
3. Append tool result messages and continue the stream.
4. Surface tool execution failures as `tool-error` events.
5. Keep permission, UI, and persistence decisions outside the package.

Acceptance criteria:

- In-memory tool fixtures can complete a two-step tool-call conversation.
- Consumers can still choose to manually handle tool calls without the runtime.

### Phase 5: Opencode integration adapter

Goal: use the package from opencode without migrating every provider.

1. Add a small translator from opencode's current session state into
   `LLMRequest` outside the package.
2. Add a translator from `LLMEvent` into current session processor events outside
   the package if needed.
3. Gate native OpenAI Chat behind an experimental config flag.
4. Keep AI SDK as the default path during evaluation.
5. Compare request payloads and event sequences for simple prompts and tool
   calls.

Acceptance criteria:

- The package remains session-agnostic.
- Native OpenAI Chat can run one real request behind a flag.
- Existing AI SDK behavior remains the default fallback.

### Phase 6: Add more protocols

Goal: prove the abstractions hold for less uniform providers.

Order:

1. OpenAI Responses for GPT-5 and OAuth-like flows.
2. Anthropic Messages for thinking, cache control, and strict tool rules.
3. Gemini for schema sanitation and thinking config.
4. Bedrock once Anthropic and Gemini target ASTs are stable.

Acceptance criteria:

- Each protocol has target schemas, chunk schemas, fixture tests, and patch
  tests.
- Provider-specific weirdness lives in adapter-local lowerers or named patches.
- No consumer code branches on provider internals to build request payloads.

## MVP defaults

Use these defaults unless implementation proves they are wrong.

- Land the first version under `packages/opencode/src/llm-core` only if creating a
  workspace package slows the prototype. Keep imports package-clean either way.
- Treat patch IDs as internal until config, plugin, or public docs reference them.
  Once referenced externally, require stable IDs and deprecation notes.
- Keep `ModelRef.native` and `LLMRequest.native` as
  `Schema.Record(Schema.String, Schema.Unknown)` for the MVP, but decode every
  consumed native value through adapter-owned schemas before use.
- Prefer native structured output when an adapter has strong fixture coverage for
  that model/protocol. Prefer forced tool calls for providers where native JSON
  schema is known to be brittle.
- Leave retries outside the package for the MVP. The transport abstraction should
  make retries injectable later without changing adapters.
- Pass resolved auth headers in `ModelRef.headers` or `TransportContext`.
  Adapters may add protocol headers like beta flags, but should not discover
  credentials.
- Expose raw provider chunks only through debug hooks and fixture helpers, not as
  required consumer events. Stable consumers should depend on `LLMEvent` plus
  patch traces.
- Make `stream` the only required adapter runtime path. Implement `generate` by
  accumulating `LLMEvent`s so streaming and non-streaming behavior cannot drift.
- Keep tool execution opt-in. The default adapter stream ends at tool-call events
  and finish events; `ToolRuntime` is a helper layered above it.

## Migration risks

The main migration risk is not type modeling. It is behavioral parity around
provider-specific invalid histories and streaming edge cases.

High-risk areas:

- Cross-provider replay of historical tool calls and tool results.
- Partial tool input JSON and providers that emit missing or malformed args.
- Reasoning/thinking content that must be preserved for one provider and removed
  or converted for another.
- Cache-control metadata attached at message vs content-block vs provider-option
  level.
- Streams that emit finish markers before the HTTP body closes.
- Usage accounting with cached input, output, and reasoning token fields.
- Provider-specific schema sanitation, especially Gemini/OpenAPI-like schemas.

Mitigation:

- Start with OpenAI Chat because the request shape is simple and opencode already
  relies heavily on OpenAI-compatible providers.
- Add OpenAI Responses second because it exercises IDs, reasoning, item-style
  input, and modern GPT-5 behavior.
- Convert current `src/provider/transform.ts` branches into named patches one at
  a time. Each extracted patch needs a fixture before removing the old branch.
- Run differential tests against AI SDK fixtures during migration, but do not make
  AI SDK parity a permanent product requirement.
- Keep the current AI SDK path as the default until a native adapter has fixture
  parity for text, tools, reasoning, abort, usage, and provider errors.

## First implementation slice

The smallest useful implementation should be docs-to-code mechanical.

1. Create `llm-core/schema.ts` with only schemas and errors.
2. Create `llm-core/patch.ts` with pure patch planning and trace tests.
3. Create `llm-core/target.ts` with the minimal `TargetBuilder` interface. Add
   fragments only when a real adapter needs them.
4. Create `llm-core/adapter.ts` with the shared runner but no real provider.
5. Add a fake adapter and in-memory transport contract test.
6. Add `provider/openai-chat.ts` only after the fake adapter proves the runner
   boundaries.

This avoids mixing protocol debugging with core algebra debugging.

## Open decisions

- Should patch IDs be public stable API or internal implementation detail?
- Should `native` request/model data be `Schema.Record(String, Unknown)` or
  adapter-declared schemas per protocol?
- Should structured output default to forced tool calls for consistency or native
  JSON schema for capability use?
- Should the package include retry policy or leave retries entirely to consumers?
- Should the package expose raw provider chunks for debugging, or only decoded
  events plus traces?
- Should adapters own auth headers, or should consumers pass fully resolved
  headers in `ModelRef` and `TransportContext`?
