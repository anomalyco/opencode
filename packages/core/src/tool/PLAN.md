# V2 Tool Result And Execution Simplification Plan

## Status

This document describes the agreed target design for V2 tools. It is an implementation plan, not documentation for the current API.

The current semantic overview remains in [`specs/v2/tools.md`](../../../../specs/v2/tools.md) until this plan is implemented. The plan's base is `origin/v2` at `b91dd78ab3`. Progress-event ephemerality already landed there (`5a9ed4d350`, `fix: make tool progress live-only`), including the failed-event partial snapshot this plan builds on. Delta-compressed progress is a later follow-up.

## Reader And Job

This plan is for the engineer changing the V2 Plugin, AI, Core, Schema, Protocol, Client, CLI, and TUI packages.

After reading it, that engineer can replace the current `output` / `structured` / `content` / `result` settlement graph with one canonical tool outcome without breaking request-scoped execution snapshots, Code Mode, MCP, provider-hosted tools, partial failure output, durable replay, or frontend rendering.

## Decision

V2 tools will have one typed execution output and three explicit consumers:

```text
execute
  -> typed domain Output
       |
       +-> encode with output schema -> Code Mode value
       +-> toModelOutput             -> bounded model content
       +-> toMetadata                -> optional bounded UI metadata
```

The typed `Output` is execution-local. Durable history stores canonical model content and optional JSON metadata, never a generic copy of `Output`.

A successful durable tool has one model-visible representation:

```text
Completed = Input x NonEmptyContent x Metadata?
```

A failed durable tool has one error plus an optional final snapshot of partial observations:

```text
Failed = Input x Error x PartialContent? x Metadata?
```

Failure metadata is never produced by `toMetadata` (which requires a domain `Output` that a failed execution never produced). Its only producer is the last live progress snapshot: the publisher retains the latest progress in process memory and copies its content and metadata into the terminal failed event. This mechanism already landed in `5a9ed4d350` (`fix: make tool progress live-only`).

Provider call and result state remain separate because they preserve irreducible provider-native replay information, not another generic tool result.

## Why The Current Model Must Change

### One settlement has several authorities

The current path can represent one call with independently mutable values:

```ts
{
  result: { type: "json", value: { ok: true } },
  output: {
    structured: { ok: false },
    content: [{ type: "text", text: "failed" }],
  },
  error: {
    type: "tool.execution",
    message: "A third outcome",
  },
}
```

The publisher, projector, model replay, frontend, and provider replay can select different authorities from that value.

### Local failures are represented repeatedly

A local `ToolFailure` currently becomes:

1. An error-valued `ToolResultValue`.
2. A separate `SessionError.Error`.
3. A durable failed event containing both.
4. A projected error state containing both plus the latest progress `content` and `structured` snapshot.
5. A newly constructed model error envelope during replay.

Local replay ignores the stored result and constructs another value from `error`, `content`, and `structured`. Provider-executed replay instead trusts the stored result.

### Default structured output leaks raw domain output

Typed tools copy their complete encoded output into `structured` unless they declare both `structured` and `toStructuredOutput`.

For example, grep produces:

```text
Output              Match[]
model content       formatted bounded text
frontend structured { value: complete Match[] }
```

The generic output store bounds model content but preserves `structured` unchanged. The complete match array therefore enters durable history and frontend state even though neither consumer requires it.

### Code Mode receives UI-shaped values

`Tool.definition` advertises `structured ?? output`, and Code Mode child execution returns `ToolOutput.structured`.

Shell therefore advertises and returns its compact structured projection:

```ts
{
  exit?: number
  shellID?: string
  truncated: boolean
  timeout?: boolean
}
```

instead of its declared output containing command output text. UI projection has accidentally become the Code Mode machine result.

### Terminal failure snapshots landed but the old fallback remains

Since `5a9ed4d350`, progress is ephemeral and the terminal failed event carries the last progress snapshot as optional `content` and `metadata`. That is the design this plan keeps.

But the projector still falls back to reaching into the previous running state when the event fields are absent, and the failed event still also carries `structured` vocabulary and an optional generic `result`. The fallback and the duplicate fields go; the projection becomes a direct copy of the event.

## Design Principles

### Keep one canonical representation

One semantic fact has one stored authority. Alternate provider, UI, and wire views are derived at their boundaries.

Do not store an inherent value and its derived representation as an unrestricted product. If two fields must agree, one is derived or deliberately cached and needs an explicit synchronization law.

### Separate domain values from boundary values

Tool-authored callbacks receive decoded domain values. Core encodes values when they cross into Code Mode, persistence, a provider, or a client.

```text
Domain callbacks receive domain values.
Transport infrastructure receives encoded values.
```

### Keep terminal events self-contained

Projecting durable history must be deterministic. A success or failure event contains every fact needed to reconstruct its terminal state without consulting ephemeral progress or process-local memory.

### Preserve independent facts

Canonical representation does not mean collapsing independent information.

A failure and partial output are independent facts: a tool can fail before producing output or after producing useful bounded output. Provider call state and provider result state are also independent.

### Add type machinery only for demonstrated failures

This plan tightens result, metadata, and lifecycle shapes because current code demonstrates contradictory states and duplicated durable data.

It does not restrict authored input schemas to JSON objects. Built-ins use object inputs and provider adapters may enforce protocol requirements at their boundaries, but no current failure justifies a more complex public input-schema generic.

## Vocabulary

| Term            | Meaning                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| Domain `Output` | The typed value returned by `execute`. It exists only during execution.             |
| Encoded output  | The validated output-codec encoding returned to Code Mode.                          |
| Model content   | The canonical non-empty text/media content sent to the model and stored durably.    |
| Metadata        | Optional bounded JSON object used for tool-specific UI and client behavior.         |
| Partial content | Bounded content observed before a failure and retained by the terminal failure.     |
| Progress        | Live running-tool observation. Its durability is outside this plan.                 |
| Provider state  | Opaque provider-owned call or result information required for native replay.        |
| Tool set        | One request-scoped snapshot pairing advertised definitions with captured executors. |

Do not use `settle` for tool execution. Use `execute` for the complete local operation and `completed` / `failed` for terminal outcomes.

## Target Tool Declaration

### Authored tools have one output

The public Effect declaration becomes conceptually:

```ts
type JsonValue = Schema.Json
type Metadata = Readonly<Record<string, JsonValue>>

type ModelOutput = string | NonEmptyReadonlyArray<Tool.Content>

interface Tool.Definition<InputSchema, OutputSchema> {
  readonly description: string
  readonly input: InputSchema
  readonly output: OutputSchema
  readonly permission?: string

  readonly execute: (
    input: Tool.InputValue<InputSchema>,
    context: Tool.Context,
  ) => Effect.Effect<Tool.OutputValue<OutputSchema>, Tool.Failure>

  readonly toModelOutput?: (input: {
    readonly input: Tool.InputValue<InputSchema>
    readonly output: Tool.OutputValue<OutputSchema>
  }) => ModelOutput

  readonly toMetadata?: (input: {
    readonly input: Tool.InputValue<InputSchema>
    readonly output: Tool.OutputValue<OutputSchema>
  }) => Metadata
}
```

`structured`, `toStructuredOutput`, and the `Structured` generic are removed.

The Promise declaration wraps the same shape and changes only `Effect` to `Promise` at the execution boundary.

### Output schemas encode JSON

An authored tool's output schema is required. Its encoded side must be JSON because the value can cross into Code Mode and the default model projection.

`Schema.Void` is not a valid tool output. A side-effect-only tool returns an honest JSON value:

```ts
Tool.make({
  input: Schema.Struct({}),
  output: Schema.Null,
  execute: () => Effect.succeed(null),
})
```

The SDK registration fixtures that currently use `Schema.Void` must change rather than weakening the tool contract.

### Projections receive domain values

Core validates the handler result by encoding it, but tool-authored projections receive the original domain value:

```ts
const output = yield * tool.execute(input, context)
const encoded = yield * encodeOutput(tool.output, output)

const projected = tool.toModelOutput?.({ input, output })
const metadata = tool.toMetadata?.({ input, output })
```

This keeps Effect codec mechanics out of author callbacks. For a codec that encodes `DateTime.Utc` as an ISO string, projections receive `DateTime.Utc`; Code Mode receives the ISO string.

### Model projection is convenient but canonicalized

Tool authors may return text directly:

```ts
toModelOutput: ({ output }) => `Found ${output.length} matches`
```

They may return rich content:

```ts
toModelOutput: ({ output }) => [
  { type: "text", text: "Generated image" },
  { type: "file", data: output.data, mime: output.mime },
]
```

Core normalizes both forms into one non-empty durable `ToolContent` array.

When `toModelOutput` is absent:

- An encoded string becomes one text content item.
- Any other encoded JSON value is serialized once and becomes one text content item.

Tools do not manually stringify rich content. Provider adapters decide how canonical content maps to provider wire formats.

### Metadata is optional and opt-in

When `toMetadata` is absent, metadata is absent. Core never copies or inspects `Output` to invent metadata.

Metadata uses one shared boundary:

```ts
const Metadata = Schema.Record(Schema.String, Schema.Json)
```

No per-tool metadata schema is introduced. Current consumers already inspect tool-specific fields defensively by tool name. A per-tool schema is justified only if OpenCode later exposes typed third-party renderer registration.

Examples of intentional metadata:

```text
shell              { exit, shellID, truncated, timeout }
edit / patch       { files }
subagent           { sessionID, status }
Code Mode execute  { toolCalls, error }
```

Grep and glob need no output metadata by default. Their input already describes the search, and their model content contains the bounded result.

### Invalid metadata cannot reverse side effects

TypeScript rejects non-JSON metadata for authored tools. Core still validates at runtime for JavaScript plugins, dynamic code, casts, cycles, and hook mutations.

If metadata is invalid or exceeds its configured ceiling:

1. Preserve the successful model content.
2. Drop metadata.
3. Log a warning with tool and call identity.

Do not fail a successful tool after side effects merely because optional UI metadata is malformed.

## Dynamic And MCP Tools

### Dynamic output schemas are optional

Authored native tools require output schemas. Dynamic external tools may omit them because the source protocol may not provide one.

Code Mode exposes a dynamic tool without an output schema as:

```ts
tools.server.tool(input): Promise<unknown>
```

Use `unknown`, not `any`. Runtime behavior is identical, but the model-visible signature must not claim properties that were never declared.

### MCP keeps its protocol distinction inside the adapter

MCP legitimately returns two values:

```text
content            text/images for the model
structuredContent  machine-readable output for Code Mode
```

The MCP adapter applies these rules:

```text
MCP isError
  -> Tool.Failure

MCP success with outputSchema
  -> require and validate structuredContent
  -> Code Mode receives structuredContent
  -> model receives bounded MCP content

MCP success without outputSchema
  -> Code Mode receives structuredContent ?? joined text ?? null
  -> Code Mode signature is unknown
  -> model receives bounded MCP content
```

Missing or invalid `structuredContent` is a failure when the MCP server advertises an output schema. Falling back to text would violate the advertised Code Mode return contract.

The complete MCP protocol envelope is not exposed as the Code Mode result. MCP metadata remains adapter-owned unless an explicit compact UI projection requires it.

## Request-Scoped Tool Sets

### Snapshot definitions and executors together

The registry exposes one request-scoped tool set:

```ts
interface ToolRegistry {
  readonly snapshot: (permissions?: PermissionV2.Ruleset) => Effect.Effect<ToolSet>
}

interface ToolSet {
  readonly definitions: ReadonlyArray<LLM.ToolDefinition>
  readonly execute: (input: ToolExecuteInput) => Effect.Effect<ToolExecution, ToolInfrastructureError>
}
```

`snapshot` replaces `materialize`. `ToolSet` replaces `Materialization`. `execute` replaces the nested `resolveToolCall` / `settleTool` / `settle` vocabulary.

The temporal guarantee remains unchanged: one model request executes exactly the tool values it advertised even if registration changes while the request is in flight.

Scoped overlays, permissions, Code Mode synthesis, and atomic batch registration remain private registry behavior.

### Request hooks return one restricted operation

`SessionModelRequest.prepare` applies request-time tool-definition transforms and returns:

```ts
interface PreparedRequest {
  readonly request: LLM.Request
  readonly executeTool: ToolSet["execute"]
}
```

The runner does not receive the raw tool set, removed-name information, or a resolver union. A call to an unknown or hook-removed tool produces the same unavailable failure for that call.

### Unavailable calls fail independently

Rejecting one unavailable call must publish one terminal error for that call ID. It must not call the whole-step `failUnsettledTools` path or fail unrelated concurrently executing calls.

Malformed unknown and hook-removed calls share the same continuation rule: continue when Step allowance remains; stop when it is exhausted.

### The final Step keeps definitions

Core prepares the same request-scoped tool set on the final Step, retains definitions, sets `toolChoice: "none"`, adds the max-Step prompt, and rejects any violating local call at runtime.

Tool definitions never leave the request, because removing them changes the prompt prefix and breaks provider prompt caching on the most token-heavy request of the session. Adapters lower `toolChoice: "none"` natively where the wire protocol supports it (OpenAI; Anthropic `{"type": "none"}`; Gemini function-calling mode `NONE`) — the Anthropic and Gemini adapters currently drop tools instead and must be fixed. Where the protocol has no "none" (Bedrock Converse), keep the definitions with `auto` and rely on the max-Step instruction plus local runtime rejection. Core does not structurally remove the tool set or create an optional execution snapshot.

## Internal Execution Outcome

The registry returns a discriminated union instead of parallel `result`, `output`, and `error` fields:

```ts
type ToolExecution =
  | {
      readonly status: "completed"
      readonly output: Schema.Json
      readonly content: NonEmptyReadonlyArray<ToolContent>
      readonly metadata?: Metadata
      readonly outputPaths?: ReadonlyArray<string>
    }
  | {
      readonly status: "error"
      readonly error: SessionError.Error
      readonly content?: NonEmptyReadonlyArray<ToolContent>
      readonly metadata?: Metadata
      readonly outputPaths?: ReadonlyArray<string>
    }
```

`output` is the validated encoded value for Code Mode and remains ephemeral. Durable publication drops it.

Expected `Tool.Failure` values become the error branch. Interruption, defects, and infrastructure failure remain in the Effect failure/cause channel and follow runner policy.

### Partial failure observations are explicit

The execution owner retains the latest bounded progress snapshot (content plus metadata) in process memory. If execution fails after producing progress, the terminal error branch snapshots those values once. This landed in `5a9ed4d350`: `failureSnapshot` in `publish-llm-event.ts` copies the retained progress into the failed event, and the projector prefers the event fields.

This preserves current TUI, ACP, noninteractive, and model behavior without retaining periodic progress durably.

In the target model, the progress channel's `structured` field is renamed `metadata` so one vocabulary pair holds everywhere: content for the model, metadata for the UI. Progress is ephemeral, so the rename touches no durable data.

A failure before progress has no content and no metadata. `Tool.Failure.metadata` is still removed because repository code does not consume it and it would create a second metadata authority; failure metadata comes only from the progress snapshot.

## Durable Events And Session State

### Success stores one model representation

The successful durable event and message state become:

```ts
interface ToolSucceeded {
  readonly content: NonEmptyReadonlyArray<ToolContent>
  readonly metadata?: Metadata
  readonly executed: boolean
  readonly resultState?: ProviderState
}

interface ToolStateCompleted {
  readonly status: "completed"
  readonly input: Readonly<Record<string, JsonValue>>
  readonly content: NonEmptyReadonlyArray<ToolContent>
  readonly metadata?: Metadata
}
```

There is no generic `structured` field and no optional generic `result` field.

### Failure stores one error and an optional final snapshot

The failed durable event and message state become:

```ts
interface ToolFailed {
  readonly error: SessionError.Error
  readonly content?: NonEmptyReadonlyArray<ToolContent>
  readonly metadata?: Metadata
  readonly executed: boolean
  readonly resultState?: ProviderState
}

interface ToolStateError {
  readonly status: "error"
  readonly input: Readonly<Record<string, JsonValue>>
  readonly error: SessionError.Error
  readonly content?: NonEmptyReadonlyArray<ToolContent>
  readonly metadata?: Metadata
}
```

The current failed event (post-`5a9ed4d350`) already carries optional `content` and `metadata`; the remaining change is deleting `structured` and `result` and typing `metadata` as JSON.

The terminal failed event carries the bounded partial snapshot required for deterministic reload. The projector copies the event; it does not reach backward into running progress state.

### Provider replay state remains orthogonal

Provider call and result state remain separately owned by the assistant tool envelope. They contain only provider-native information required for valid continuation syntax. Generic local success and failure do not retain a second provider-style result.

The two current adapters have known, different replay facts:

- OpenAI Responses replays a hosted tool as an `item_reference` built from the item ID already stored in `providerMetadata`. It needs no payload.
- Anthropic server tools (`web_search`, `code_execution`, `web_fetch`) must round-trip the complete structured result payload verbatim as a typed `*_tool_result` block on every subsequent stateless request. The payload includes encrypted fields that cannot be reconstructed from text.

Therefore the Anthropic adapter stores that payload in provider-owned `resultState` at write time, and hosted replay lowering reads `resultState` instead of a generic `result`. The new terminal events never carry a generic `result` field, and Anthropic hosted continuation works in the final state.

Retaining the complete payload is a concrete exception to the general preference against archiving provider output. It is permitted only because the provider protocol requires the value for continuation. Generic output bounding does not apply to `resultState`; bounding applies to the derived model content.

### Projection is a direct fold

The projector performs no result inference:

```text
ToolSucceeded -> ToolStateCompleted
ToolFailed    -> ToolStateError
```

It does not infer JSON from empty content, convert `structured` to content, reconstruct an error result, or inherit ephemeral progress.

### Existing durable data migrates once

Tool events and projected message rows already exist in beta databases. The decided migration path is a one-time rewrite, not read-time normalization:

1. Bump the versions of the terminal tool events. Old-version rows fall out of `DurableEventManifest` and are silently skipped by `readAfter`; no event `DELETE` is required.
2. Add one TypeScript migration in `packages/core/src/database/migration/` that rewrites existing `session_message` tool rows into the new `ToolState` shape: `content` from old content, else one stringified text item from old `structured`/`result`; `error` preserved. For `executed: true` rows, copy the old generic `result` into provider-owned `resultState` so Anthropic hosted continuation survives the migration. This is required because `SessionHistory.load` hard-fails with `MessageDecodeError` on undecodable rows.
3. Build no read-time compatibility boundary. `SessionEvent.All` stays latest-version-only. Do not carry `structured` and `result` into new events for source compatibility.

Known accepted consequence: `EventV2.replay`/`replayAll` have no production call sites today (tests and future sync only), so skipped old event versions cannot break a production rebuild. A hypothetical future replay of pre-migration history would produce sessions missing tool results; that is acceptable beta data loss.

Extend `packages/core/test/database-migration.test.ts` with an old-fixture database containing pre-migration tool rows.

## Hooks

### Preserve output paths in this change

`execute.after` keeps `outputPaths`. Removing managed path visibility is not part of this plan.

The hook receives the canonical projected outcome, optional metadata, and output paths. It does not receive raw domain `Output` or the old `ToolOutput`:

```ts
type ToolExecuteAfterEvent = ToolHookBase &
  (
    | {
        status: "completed"
        content: NonEmptyReadonlyArray<ToolContent>
        metadata?: Metadata
        outputPaths?: ReadonlyArray<string>
      }
    | {
        status: "error"
        error: SessionError.Error
        content?: NonEmptyReadonlyArray<ToolContent>
        metadata?: Metadata
        outputPaths?: ReadonlyArray<string>
      }
  )
```

Preserve current hook ordering for this implementation: hooks run after generic bounding and may inspect output paths. Reordering hooks, applying a second bound, and changing spill ownership are follow-up decisions unless implementation reveals a concrete correctness blocker.

## Output Bounding

### Producers and Core have separate responsibilities

Producers own capture semantics:

- Shell/process tools choose tail versus head, maintain backing files, and report producer truncation.
- Read and search tools page or limit their results.
- Other tools may impose smaller domain-specific limits.

Core owns one configurable final line-and-UTF-8-byte ceiling for durable model content. Producers may return less but may not bypass the final ceiling.

The ceiling's default cut keeps the existing head-plus-tail split with the omission marker in the middle: the head shows what the output is, the tail is where errors and summaries live. Producers may choose pure head or pure tail where their domain warrants it.

Do not introduce model-specific token counting.

### Spill is producer-specific

Generic Core bounding does not archive every omitted byte. Shell/process producers may retain complete output temporarily because it is expensive to reproduce. Read and search tools page or rerun. Provider-hosted omitted bytes are not hidden in a second archive solely for replay.

Keep existing output paths where a producer or current managed store intentionally creates them. Removing generic spill storage is separate follow-up work and must not be bundled into the canonical result migration without focused tests.

### Metadata never becomes an unbounded side channel

Metadata is measured independently from model content. Oversized metadata is dropped and logged; it never fails a successful side effect and never stores a hidden complete copy.

### Hosted tools are bounded at the common publisher seam

Provider-hosted tools bypass local execution. Their model-facing content must pass through the same final publisher bound before entering durable history.

Retain only provider identifiers or state required for valid native continuation syntax. Do not archive omitted hosted bytes when the provider can continue without them.

Before applying a generic text bound to a provider-native structured result, prove that continuation uses an identifier or define an adapter-specific schema-preserving bound. A bounded text preview cannot silently replace a structured payload that the provider requires on replay.

## Public API And Package Changes

### Plugin declarations only

The public Plugin package exports declaration construction and registration types. It no longer exports the execution interpreter as `Tool.settle`.

Core privately interprets registered declarations. SDK-next re-exports the same declaration API; it does not expose a second execution model.

### Remove overloaded settlement vocabulary

Remove or rename:

| Current                    | Target                                           |
| -------------------------- | ------------------------------------------------ |
| `Tool.settle`              | private Core execution                           |
| `ToolRegistry.materialize` | `ToolRegistry.snapshot`                          |
| `Materialization`          | `ToolSet`                                        |
| `Materialization.settle`   | `ToolSet.execute`                                |
| `Settlement`               | `ToolExecution`                                  |
| `settleTool`               | private execution body                           |
| `stepSettlement`           | `stepCompletion` where still needed              |
| `tool.settled`             | `tool.completed` where still needed              |
| `Progress.structured`      | `Progress.metadata` (ephemeral; no durable data) |

Do not introduce both `invoke` and `execute`. `execute` is the one operation verb.

### Add a changeset

The Plugin package is public. Removing `structured`, `toStructuredOutput`, `Tool.settle`, and the old hook shape is user-facing even if the API is labeled V2.

Hand-write a `.changeset/*.md` entry mimicking the existing hand-authored entries (no changesets tooling is installed in this repo) describing the declaration and hook migration. Do not silently retain obsolete overloads unless a shipped compatibility requirement is confirmed.

## Implementation Work Order

This is one implementation pass to the final state on one branch, not a sequence of independently green commits. No transitional compatibility machinery is built: the old and new tool APIs never coexist, and no temporary adapter feeds old fields from new values. Intermediate commits may be red; the work order below exists only because later steps consume types and values created by earlier ones.

Two exceptions to "just get to the final state":

1. Step 1's baselines are written first, on the unmodified base, because tests pinning current observable behavior are the only proof the rewrite preserved it. Baselines written afterward would merely pin whatever the rewrite happens to do.
2. The completed branch is verified as one unit: package typechecks and tests, regenerated Protocol/Client surfaces, the regenerated legacy JS SDK, and the migration fixture.

### 1. Establish regression baselines

Most invariants are already tested and need only mechanical updates during the rewrite: snapshot capture (`session-runner-tool-registry.test.ts` "executes the tool advertised in a model request", "reveals the previous registration after an overlay closes"), parallel tools (`session-runner.test.ts` "Run parallel tools"), final-Step `toolChoice: "none"` (four assertions across session-runner and session-generate tests), `Promise<unknown>` for schema-less Code Mode tools (`codemode.test.ts`), hosted-tool lowering (`packages/ai` provider tests), shell failure output at the tool level (`tool-shell.test.ts` "keeps non-zero exits useful", "returns a useful timeout settlement"), and the failure partial snapshot (`5a9ed4d350` added "persists the latest partial snapshot when a tool fails", "interrupted progress publication remains in the terminal failure snapshot", and "failure before progress omits partial output fields").

Write only the three missing baselines, on the unmodified base:

- One Anthropic hosted-tool storage round trip: persist a server-tool result, reload, lower the next request, assert the typed result block carries the exact payload.
- MCP `isError: true` becomes one failed tool call (current MCP tests only exercise `isError: false`).
- MCP mixed text-plus-image content reaches the model request intact.

Assert through public surfaces so the tests survive the rewrite. Target-state behaviors (grep/glob raw arrays disappearing, per-call unavailable failure, runtime final-Step rejection) are verified in the matrix afterward, not baselined.

Do not rewrite behavior yet.

### 2. Introduce canonical content and metadata types

Add shared types for:

- Non-empty tool content.
- JSON metadata.
- Completed and failed terminal outcomes.

Constrain content and metadata schemas at their actual persistence and protocol boundaries. No adapters to the old representation: consumers move to these types directly in the later steps.

### 3. Change the authored Tool API

Update Effect and Promise declarations:

- Delete `Structured`.
- Delete `structured`.
- Delete `toStructuredOutput`.
- Add `toMetadata`.
- Change `toModelOutput` to accept domain `Output` and return text or non-empty rich content.
- Require JSON-encoded native outputs.
- Remove public `Tool.settle`.
- Update SDK-next exports and registration fixtures.

Migrate all built-ins to the new declaration in the same pass. Add metadata only when a current consumer requires it.

### 4. Replace registry settlement with ToolExecution

Introduce `ToolRegistry.snapshot` and `ToolSet.execute`. Move schema interpretation into private Core code.

Return the completed/error union. Capture bounded partial progress for terminal failures. Preserve registration atomicity, overlays, permissions, and Code Mode capture.

### 5. Give Code Mode encoded Output

Change Code Mode child execution to return `ToolExecution.output`, the validated encoded value — not metadata or model content.

Verify shell, read, grep, glob, edit, patch, subagent, and Code Mode execute signatures. Dynamic tools without output schemas remain `Promise<unknown>`.

### 6. Adapt MCP and dynamic tools

Implement strict MCP output-schema validation and the agreed fallback behavior. Keep the protocol split private to the MCP adapter.

Test text, image, mixed content, structured content, missing structured content, invalid structured content, remote failure, and absent output schema.

### 7. Version terminal events and migrate projected state

Add canonical success/failure event versions. Change terminal Session message states. Add the one-time TypeScript row migration and its old-fixture test described in "Existing durable data migrates once". No read-time normalization layer.

In the same step, move Anthropic hosted-tool payloads to provider-owned `resultState`: the adapter writes the payload there, hosted replay lowering reads it, and the row migration copies old `executed: true` results into it. OpenAI continues replaying from `providerMetadata` item IDs unchanged. No new event shape ever carries a generic `result`.

New SQL queries against the event table must use the new versioned-type constants; old-version rows are intentionally invisible to them.

Regenerate public Protocol and Client surfaces after changing the assembled `HttpApi`, and regenerate the legacy JS SDK (`./packages/sdk/js/script/build.ts`) because it merges the V2 OpenAPI document. Do not edit generated sources directly.

### 8. Simplify publication and replay

Delete local result reconstruction and duplicate provider/local branches where canonical state makes them unnecessary.

The publisher emits one terminal event. The projector copies it. Model replay derives provider wire output from canonical content or error plus provider-owned state. With Anthropic payloads already living in `resultState` after step 7, deleting the generic `result` reconstruction paths is pure removal.

### 9. Simplify request dispatch

Make `SessionModelRequest.prepare` return one request-specific execution operation. Delete `resolveToolCall` and removed-name continuation distinctions.

Fix per-call rejection so one unavailable call cannot fail unrelated fibers.

### 10. Stabilize final-Step behavior

Always snapshot tools. Retain definitions, set `toolChoice: "none"`, add the max-Step instruction, and reject violating execution locally. Fix the Anthropic and Gemini adapters to lower "none" natively instead of dropping tool definitions; keep Bedrock Converse definitions with `auto` since its protocol has no "none". Definitions stay in the request to preserve prompt caching.

### 11. Migrate hooks

Replace the old `ToolOutput` hook payload with the canonical outcome while preserving `outputPaths` and current ordering. Update Promise plugin bridges and focused hook tests.

### 12. Consolidate bounding

Apply the final Core ceiling to local and hosted model content. Validate and bound metadata independently. Preserve producer-specific truncation/spill behavior.

Do not implement progress deltas in this step.

### 13. Delete obsolete machinery and update documentation

Delete unused settlement conversions, types, branches, and compatibility adapters after all callers use the canonical model.

Update `specs/v2/tools.md` to describe implemented behavior, update the V2 schema changelog, add the Changesets entry, and remove this plan when its remaining work is fully represented by current specifications and tracked issues.

## Verification Matrix

### Plugin

- Effect Schema and Standard Schema input/output inference.
- Domain output passed to projections.
- Encoded JSON returned to Code Mode.
- Text and rich-content normalization.
- Metadata compile-time type safety and runtime validation.
- Promise wrapper parity.
- Public execution interpreter no longer exported.

Run from `packages/plugin` and `packages/sdk-next`.

### Code Mode

- Declared outputs produce accurate signatures.
- Missing dynamic output schemas produce `unknown`, never `any`.
- Native execution returns encoded output.
- Invalid encoded output fails before Code Mode observes it.
- Shell output text is available to Code Mode.

Run from `packages/codemode` and `packages/core`.

### MCP

- `isError` becomes one tool failure.
- Model content preserves text and images.
- Declared structured output is required and validated.
- Missing dynamic output schema retains unknown fallback behavior.
- Complete MCP envelopes do not leak into generic Code Mode output or metadata.

Run from `packages/core`.

### Registry And Runner

- Definitions and executors come from one captured snapshot.
- Registration changes affect only later requests.
- Different Sessions execute concurrently.
- Same-Session coordination remains serialized by the existing coordinator.
- Local tools execute in parallel within a Step.
- Durable publication remains serialized.
- Provider-hosted tools never invoke local handlers.
- Unknown and hook-removed calls fail independently.
- Final-Step violations fail only their call.

Run focused tests from `packages/core`.

### Persistence And Replay

- New success state has required non-empty content and optional metadata.
- New failure state has one error plus an optional partial content/metadata snapshot sourced from the last live progress.
- Progress is not required to rebuild terminal state.
- The row migration rewrites an old-fixture database deterministically; old event versions are skipped on read.
- Local model replay uses canonical content/error.
- Provider replay uses canonical outcome plus irreducible provider state.
- OpenAI hosted replay preserves item-reference behavior.
- Anthropic server-tool replay preserves the native structured result block.
- Projection followed by reload preserves the same terminal outcome.

Run focused Schema and Core tests from their package directories.

### Frontends

- TUI renders successful text/media and tool-specific metadata.
- TUI preserves partial output before a terminal error during live streaming and hydration.
- ACP reports canonical content and metadata without raw `structured` output.
- Noninteractive CLI renders partial failure content followed by the error.
- Unknown plugin tools retain a generic content fallback.
- Grep and glob no longer send complete raw arrays as UI metadata.

Run from `packages/tui` and `packages/cli`.

### Generated Surfaces

After public Protocol or Server `HttpApi` changes:

```sh
cd packages/client
bun run generate
```

Run package-local type checks with `bun typecheck`. Do not run tests from the repository root.

## Laws

- **One domain output:** `execute` produces exactly one typed `Output`.
- **Validated machine output:** Code Mode observes exactly the output codec's validated encoding.
- **Domain projection:** `toModelOutput` and `toMetadata` observe decoded input and domain output.
- **Canonical success:** a completed tool has exactly one non-empty model-content representation.
- **Canonical failure:** a failed tool has exactly one error representation.
- **Independent partial output:** failed content, when present, means bounded output observed before failure.
- **Metadata opt-in:** absent `toMetadata` produces absent metadata, never copied output.
- **JSON metadata:** persisted metadata is a bounded JSON object.
- **Deterministic projection:** terminal state is a pure fold of durable terminal events and does not depend on ephemeral progress.
- **Captured execution:** a call executes the exact tool value advertised in its request.
- **Per-call rejection:** rejecting one call cannot fail another call.
- **Provider-state separation:** provider-native replay state is not a second generic tool outcome.
- **No hidden archive:** omitted hosted or generic bounded bytes are not retained under another field unless they are irreducible provider continuation state.

## Non-Goals

- Designing progress-event ephemerality; that work is already in progress separately.
- Designing generic metadata or content delta schemas.
- Removing `outputPaths` from `execute.after`.
- Reordering `execute.after` or adding a second bounding pass without a concrete blocker.
- Restricting authored input schemas beyond demonstrated provider-boundary requirements.
- Redesigning execution locus, assistant lifecycle, usage totals, `ToolChoice`, or shell lifecycle; those findings are tracked separately.
- Adding typed third-party renderer registration.
- Implementing clustered Session execution ownership.
- Archiving complete provider-hosted output solely for exact replay.

## Follow-Up Tracking

- `e54e9273`: resume the V2 tool architecture design session.
- `989201eb`: delta-compress tool progress after ephemeral progress lands.
- `f3f4cfc9`: audit unrelated V2 canonical state representations.

## Fixed-Point Check

The target is ready to implement when these statements remain true under examples for shell, grep, read, edit, subagent, Code Mode, MCP, and provider-hosted tools:

- Removing any target field breaks a demonstrated consumer or guarantee.
- Adding another generic result field creates no new legitimate observation.
- Every stored fact has one canonical representation.
- Every derived representation is created at a named boundary.
- Success, failure, partial output, metadata, and provider state remain independently expressible where the domain permits them.
- Request snapshots preserve definition/executor identity.
- Old durable data has one explicit one-time migration path.
- Remaining complexity buys a demonstrated behavior rather than compatibility with accidental current structure.
