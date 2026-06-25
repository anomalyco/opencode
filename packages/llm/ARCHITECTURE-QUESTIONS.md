# LLM Architecture Questions

Status: discussion agenda

This document tracks the remaining architectural questions for the LLM package and its OpenCode integration. It is
intentionally narrower than `DESIGN.md`: each section should end in a concrete ownership rule, data shape, or law.

## Initial Release Scope

The first release targets OpenCode's internal V2 runtime. It does not attempt to be a complete general-purpose AI SDK.

In scope:

- Effect API only.
- Exactly one provider request per call.
- Provider-neutral request, response, event, usage, and error models.
- Translation between normalized data and provider-specific APIs.
- Provider configuration, endpoint construction, authentication, and transport.
- Returning normalized tool calls without executing them.
- Provider-specific continuation metadata required for later turns.
- Usage, cache usage, and estimated cost data needed by OpenCode.
- A clean boundary from OpenCode config/catalog models into executable models.
- Recorded real-provider tests covering supported models, capabilities, and failure modes.

Out of scope:

- Local tool execution.
- Automatic tool loops or multi-turn runs.
- Durable orchestration or persistence.
- Promise APIs.
- A polished external-consumer API.

Release sequence:

```text
1. Internal OpenCode integration
2. Public Effect API
3. Promise facade
```

A future complete-run layer can be built from the one-turn primitive after OpenCode validates the underlying data
model. The initial implementation should not anticipate it by adding orchestration now.

## 1. Orchestration Ownership

The initial package exposes only one provider turn:

```ts
const result = yield * LLM.generate({ model, request })
const events = LLM.stream({ model, request })
```

OpenCode needs granular control over admission, persistence, permissions, tool settlement, interruption, compaction,
steering, and continuation. It cannot hand durable Session orchestration to an in-memory tool loop.

Settled boundary:

```text
LLM package owns
  provider request lowering
  transport
  provider stream parsing
  normalized turn events

OpenCode owns
  durable prompt admission
  persisted history
  permissions
  durable tool execution and settlement
  steering and queuing
  compaction
  provider-turn continuation
  interruption and recovery policy
```

Laws:

> `generate` and `stream` perform exactly one provider request and never execute a local tool or start another provider
> turn.

> The package has no hidden conversation or run state between calls.

Remaining questions:

1. Which lifecycle events are stable enough for OpenCode to persist?
2. Where do retries live: transport, provider turn, or caller policy?
3. Can OpenCode reconstruct every continuation decision from turn inputs and outputs?

## 2. Protocol-Native Continuation Data

Providers return opaque data that may be required when continuing a conversation:

- Anthropic reasoning signatures
- Bedrock reasoning signatures
- OpenAI encrypted reasoning content and item IDs
- Gemini thought signatures
- Provider-hosted tool identifiers and continuation handles

The normalized message model currently carries this data in `providerMetadata`:

```ts
const message = Message.assistant([
  {
    type: "reasoning",
    text: "...",
    providerMetadata: {
      anthropic: {
        signature: "...",
      },
    },
  },
])
```

### Namespace Is Not Provenance

The `anthropic` key does not necessarily mean "returned by Anthropic." It identifies data understood by the Anthropic
Messages protocol adapter. Anthropic, an Anthropic-compatible provider, and a gateway translating to Anthropic
Messages may all read and write the same shape.

The namespace answers:

> Which protocol codec understands this data?

It does not answer:

> Which implementation produced it, and where can it be replayed safely?

Those concerns remain separate, but they do not require a new envelope on each content part. The assistant message
already records its originating provider and model. The metadata key selects the adapter-specific shape, while the
message identity supplies the conservative compatibility check.

The unsafe case is not only switching providers. Two models behind the same Anthropic-compatible endpoint have
incompatible thinking blocks:

```text
Minimax response
  -> persisted Anthropic-shaped signature
  -> switch to Claude Haiku
  -> signature is structurally present but invalid for Haiku
```

A protocol-namespace check is therefore insufficient. Anthropic also documents that signatures for the same model are
compatible across its direct API, Amazon Bedrock, and Vertex AI. Provider equality is consequently conservative rather
than a fundamental property of the signature.

### Settled Initial Rule

The initial OpenCode integration uses the identity already persisted on each assistant message:

```ts
const sameModel = message.providerID === target.providerID && message.modelID === target.modelID
```

Request projection is fully automatic:

```ts
const content = message.content.flatMap((part) => {
  if (part.type !== "reasoning") return [part]
  if (sameModel) return [part]
  if (part.text === "") return []
  return [{ type: "text" as const, text: part.text }]
})
```

- For an exact provider/model match, preserve the reasoning part and its `providerMetadata`. The selected protocol
  adapter consumes the namespace it understands, such as `anthropic.signature`, `bedrock.signature`, or
  `google.thoughtSignature`.
- For any provider or model change, omit all opaque continuation metadata from the transient request projection and
  lower visible reasoning text to ordinary assistant text.
- Do not mutate durable history. A later switch back to the original provider/model can still use the preserved native
  reasoning part and metadata.
- Do not add `routeID`, `protocolID`, `origin`, `replayScope`, or a compatibility envelope to each part for the initial
  implementation.
- Do not expose an adaptation API for this case. Request projection owns the automatic compatibility rule.

The provider namespace remains useful because it tells the selected adapter how to encode the opaque payload. It does
not independently authorize replay.

This rule intentionally drops some documented-compatible continuations, including the same Claude model reached
through Anthropic and Bedrock. Broader compatibility may be added later as a model compatibility relation after
recorded cross-platform tests prove the exact identity mapping. It does not require changing the persisted part shape.

Laws:

> Native reasoning continuation metadata is projected only for an exact originating provider/model match.

> A provider or model switch preserves non-empty visible reasoning as ordinary assistant text and projects no opaque
> continuation metadata.

> Request projection never mutates the durable assistant message.

> Metadata namespaces select encoding logic; they do not establish replay compatibility.

## 3. Message Portability

Provider switching affects more than opaque metadata:

- Reasoning content may be encrypted, redacted, summarized, or absent.
- Hosted tool calls may have no portable local equivalent.
- Provider-specific content parts may not exist in another protocol.
- Tool-call IDs and assistant item IDs may have provider-specific constraints.
- Chronological system updates have different native support.

Questions:

1. What is the closed portable message algebra?
2. Which parts are portable semantics versus replay-only provider artifacts?
3. Does switching models lower history into the nearest portable representation?
4. How are dropped or transformed parts surfaced to the caller?
5. Can a continuation require the original provider even when the visible transcript is portable?

## 4. Persistence Surface

OpenCode must persist enough information to resume after process loss without persisting process-local behavior.

Questions:

1. Are normalized `TurnEvent`s the durable event contract, or only a streaming presentation?
2. Should callers persist events, assembled messages, `TurnResult`, or all three at different boundaries?
3. Which IDs are stable across streamed deltas and final assembled content?
4. Does the package provide a pure event reducer for rebuilding a `TurnResult`?
5. How are schema migrations handled for persisted provider metadata?

Desired law:

> Reducing a complete event stream produces the same result as `generate`.

## 5. Tool Execution Boundary

The package returns normalized tool calls but never executes them. OpenCode settles tools durably and constructs the
next request explicitly.

Questions:

1. What is the portable result of validating a streamed tool call?
2. How are provider-hosted tools represented without pretending they have local handlers?
3. Can tool calls or results contain provider-native metadata that constrains later replay?
4. Which tool-call IDs and argument shapes remain valid across provider changes?

## 6. Request Mutation And Hooks

The package needs typed common controls and escape hatches without making OpenCode duplicate provider logic.

Questions:

1. Which controls are portable generation semantics?
2. Which settings are provider-package inputs?
3. At what stage can hooks inspect or replace the provider-native body?
4. Are hooks allowed to change auth, transport, or protocol?
5. Which hook inputs and outputs are serializable and testable?
6. What ordering applies between model defaults, call options, hooks, and raw body/header overlays?

## 7. Errors, Retries, And Interruption

Questions:

1. Which failures are safe to retry before any model-visible output?
2. Does a partial provider stream always terminate as a failed turn?
3. Can retry policy observe whether durable output has already been committed?
4. How does Effect interruption close HTTP/WebSocket resources and tool fibers?
5. Which failures become normalized provider-error events versus Effect failures?

## 8. Usage, Cost, And Cache Accounting

Questions:

1. Is normalized usage sufficient for durable accounting, or must raw provider usage always be retained?
2. How are cached input reads/writes represented consistently?
3. Are estimated costs package output, catalog policy, or OpenCode-owned accounting?
4. How are multi-turn run totals computed when one turn lacks pricing or usage?
5. Does automatic cache placement belong to request preparation or run orchestration?

## 9. Provider Compatibility Testing

The package should distinguish itself through broad recorded tests against real provider APIs. HTTP recordings make
provider behavior reproducible without requiring live credentials in ordinary test runs.

The matrix should cover:

- Text generation and streaming.
- Tool calls and streamed tool arguments.
- Images and other claimed input modalities.
- Reasoning, signatures, encrypted content, and continuation replay.
- Prompt caching and cache usage.
- Authentication modes and custom endpoints.
- Context overflow and malformed requests.
- Rate limits, provider errors, and transport failures.
- Model/API combinations, including alternate APIs under one provider.
- Provider and model switching with persisted history.

Workflow for a new model or provider API:

```text
make representative live requests
  -> record exact HTTP interactions
  -> identify unsupported or malformed behavior
  -> fix protocol/provider lowering
  -> retain recordings as regression tests
```

Questions:

1. What minimum scenario matrix must every provider satisfy?
2. Which volatile or sensitive fields must recordings redact or normalize?
3. When does a model inherit protocol coverage versus require its own recordings?
4. How are expected provider behavior changes reviewed and re-recorded?

## Review Order

Resolve these in dependency order:

1. Portable message algebra
2. Provider metadata compatibility
3. Persistence surface
4. Hooks and mutation ordering
5. Errors, retries, and interruption
6. Usage, cost, and cache accounting
7. Provider compatibility test matrix

Initial scope and orchestration ownership are settled. The next review should focus on message portability, provider
metadata, and persistence.
