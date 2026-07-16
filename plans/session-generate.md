# Session-Aware One-Shot Generation Plan

Status: **Proposed**

## Decision

Add a Session operation that prepares one request from the Session's active model context, appends a transient prompt, executes exactly one Physical Attempt, returns the assistant text, and leaves the Session unchanged:

```ts
const { text } = await client.session.generate({
  sessionID,
  text: "Summarize where we left off.",
})
```

The operation belongs to Session because its meaning depends on Session History, selected agent and model, instructions, tools, provider transforms, hooks, and prompt-cache identity. The existing stateless `Generate.text` module remains unaware of Session.

This feature should deepen the Session request-preparation module rather than add a second approximation of the runner. The durable runner and `session.generate` must share preparation, then diverge before provider output acquires durable consequences.

## Why The Current Shape Resists This Operation

`SessionRunner.attemptStep` currently interleaves six distinct concerns:

1. It synchronizes instructions and promotes pending inputs.
2. It resolves the Session's agent and model.
3. It selects active Session History and initiates compaction when required.
4. It constructs the provider request, materializes tools, and applies Session hooks.
5. It performs one Physical Attempt.
6. It projects assistant output, executes tools, records usage, and decides whether to continue.

`session.generate` needs the middle of that sequence without the durable work on either side. Calling `session.prompt` would admit durable input and enter the full loop. Calling `Generate.text` would lose Session context and cache identity. Forking would preserve context but create temporary durable state and cleanup obligations.

The desired architecture makes request preparation independently callable while preserving one canonical implementation.

## Target Architecture

```text
session.prompt
    -> SessionAdmission
    -> SessionExecution
    -> SessionContext.snapshot
    -> SessionModelRequest.prepare
    -> LLMClient.stream
    -> SessionSettlement

session.generate
    -> SessionContext.snapshot
    -> SessionModelRequest.prepare
    -> LLMClient.generate
    -> return text
```

The modules have distinct jobs:

- `SessionAdmission` records and promotes durable input.
- `SessionContext` resolves a read-only, internally consistent view of what the selected agent would see.
- `SessionModelRequest` converts that view into the provider request used by a Physical Attempt.
- `LLMClient` executes one provider request without deciding what becomes durable.
- `SessionSettlement` gives streamed provider events their durable Session meaning, executes local tools, records usage, and decides continuation.
- `SessionCompaction` replaces oversized active history and remains a durable Session operation.

Durability becomes a property of admission and settlement, not request preparation or provider execution.

## The Core Seam

The first extraction should be one internal Location-scoped module with a small interface. Names are provisional; behavior is not.

```ts
interface SessionModelRequest {
  readonly prepare: (input: {
    snapshot: SessionContext.Snapshot
    operation: { type: "step"; current: number; maximum?: number } | { type: "generate"; prompt: Message.User }
  }) => Effect<PreparedSessionModelRequest, SessionModelRequestError>
}
```

```ts
type PreparedSessionModelRequest = {
  request: LLM.Request
  snapshot: SessionContext.Snapshot
  executableTools?: MaterializedTools
}
```

`prepare` hides:

- Session and Location validation;
- plugin flush and selected-agent resolution;
- selected-model and credential resolution;
- instruction source loading and assembly;
- active-history selection after the latest completed compaction;
- conversion to provider messages;
- provider system prompts and model headers;
- tool permission filtering and definition materialization;
- provider transforms and Session context hooks;
- Session-based prompt-cache identity.

The operation determines tool capability and request shape:

- `step` advertises tools and returns the execution capability used by durable settlement, except when the agent's Step limit disables tools.
- `generate` advertises the same definitions but returns no execution capability.

`session.generate` keeps normal tool choice so providers retain the normal request and cache shape. Several protocols omit tool definitions entirely when `toolChoice` is `none`, so that setting cannot satisfy cache-shape parity. A generated tool call is collected but never executed or continued.

Avoid a broad bag of booleans or independently selectable tool modes. The operation discriminant derives valid tool materialization and request behavior. Admission, compaction, attempts, and settlement remain separate modules rather than modes hidden inside preparation.

## Read-Only Session Context

Request preparation must not call `InstructionState.prepare`, promote pending input, or initiate compaction. Those operations mutate the Session.

Split instruction behavior into two phases:

```text
resolve and assemble current instruction context   read-only
commit the canonical model's instruction state    durable
```

Both a durable Step and `session.generate` resolve and assemble instructions. Only durable execution commits instruction-state changes. A transient request must not make the false durable claim that the canonical Session model saw an instruction update.

The context snapshot should be loaded from one consistent database view and carry a revision, likely the latest aggregate or projected sequence used to assemble it. A concurrent durable Step may advance the Session after that point; the transient request continues against its immutable snapshot.

Pending inputs remain excluded. They are not Session History until promotion, and `session.generate` must not alter admission order or expose queued work early.

## One Physical Attempt Without Settlement

Use the existing `LLMClient` interface directly. The durable runner consumes `llm.stream(prepared.request)`, while `session.generate` calls `llm.generate(prepared.request)` to collect the same event stream into its existing `LLMResponse` model. No additional provider-attempt module is needed.

`LLMClient.generate` collects exactly one provider stream. It does not retry as a new logical Step, execute tools, continue after tool calls, publish Session events, capture filesystem snapshots, or update Session usage.

The initial public result exposes only `{ text }`. Keeping richer evidence internal avoids prematurely committing the public contract while allowing tests to verify tool-call and finish behavior.

If a provider returns tool calls, collection records and ignores them. No tool hook or execution path runs. Assistant text, including an empty string, remains a successful result. Empty text is required for cache-warming calls.

## Compaction Does Not Belong In The First Operation

Normal Step preparation may discover that active context requires compaction. Compaction is durable and usually requires another provider call. Automatically compacting from `session.generate` would violate both transcript immutability and the exactly-one-attempt contract.

The first operation should use history after the latest completed compaction and fail with a typed context-overflow error when that snapshot cannot fit. It must not initiate compaction.

Transient in-memory compaction can be considered later as a separate operation or explicit policy. It should not silently weaken the first contract.

## Concurrency Uses Snapshot Semantics

The first contract should state:

> `session.generate` uses the latest committed model context captured when request preparation begins. Later Session changes do not alter the in-flight request.

The operation does not acquire ownership of the durable Session Drain and does not fail merely because the Session is running. This keeps transient generation independent from durable scheduling.

The prepared result carries the captured revision internally. A later recap integration can suppress stale output when the Session advances while generation runs. Returning the revision publicly can follow if more consumers need compare-and-display behavior.

## Hooks Follow The Stage They Affect

The existing Session context hook should run because it participates in normal request preparation. Its event should eventually identify the operation:

```ts
type SessionModelRequestOperation = { type: "step"; step: number } | { type: "generate" } | { type: "compaction" }
```

Request preparation and observation hooks run for `session.generate`. Admission, projection, Session settlement, and tool-execution hooks do not run because those stages do not occur.

The no-mutation guarantee covers OpenCode's durable Session state. Arbitrary plugin hooks may still perform external side effects.

## Public Contract

Start with the smallest useful interface:

```ts
type SessionGenerateInput = {
  sessionID: SessionID
  text: string
}

type SessionGenerateOutput = {
  text: string
}
```

The operation:

1. Resolves the Session or returns the normal Session-not-found error.
2. Captures its latest committed active model context.
3. Uses the selected agent, model, instructions, provider configuration, tools, transforms, hooks, and Session cache key.
4. Appends `text` only to the in-memory provider request.
5. Executes exactly one Physical Attempt with normal tool definitions and no executable tool capability.
6. Returns collected assistant text, including an empty string.
7. Does not admit input, publish Session events, execute tools, initiate compaction, update usage, or mutate Session projections.

Files, agent attachments, usage, model identity, finish metadata, and revision are follow-up extensions. They should be added only when a concrete caller needs them.

## Implementation Sequence

Each stage should preserve existing durable runner behavior before the next stage starts.

### 1. Characterize Current Request Preparation

Add focused tests around a normal Step's prepared request. Pin:

- selected agent and model;
- system and instruction assembly;
- active history after compaction;
- tool definitions and last-step behavior;
- provider headers and prompt-cache key;
- Session context-hook transformations.

Use a recording LLM adapter rather than reproducing request-construction logic in tests.

### 2. Extract Instruction Resolution From Durable Synchronization

Move instruction source loading and read-only assembly behind one internal interface. Keep `InstructionState.prepare` in the durable runner path. Verify that normal Steps produce byte-equivalent instruction context and unchanged durable instruction events.

This commit should not add `session.generate`.

### 3. Extract Session Model Request Preparation

Move model resolution, history selection, request construction, tool definitions, cache identity, and context hooks into the Location-scoped `SessionModelRequest` module. Make the durable runner its only caller first.

Verify the recorded normal request before and after extraction. Keep compaction detection and pending promotion outside the new module if putting them inside would make preparation mutate state.

### 4. Separate Provider Attempt From Durable Settlement

Make the runner explicitly pass `llm.stream(prepared.request)` into durable settlement. Keep event publication, tool execution, snapshots, retries, usage, and continuation behavior unchanged.

This stage should make the durable path read as orchestration:

```ts
promote -> snapshot -> compact if required -> prepare -> attempt -> settle
```

### 5. Add The Core `Session.generate` Operation

Use read-only snapshot and request preparation, append one transient user message, select advertise-only tools, collect one attempt, and return text. Add tests proving that messages, pending inputs, instruction state, Session events, snapshots, and usage remain unchanged.

Test concurrent Session advancement with deterministic synchronization around request dispatch. The generated request should retain its captured context while the source Session advances independently.

### 6. Add Protocol, Server, Client, And Plugin Surfaces

Add `POST /api/session/:sessionID/generate` to Protocol, a thin Server handler, generated Promise and Effect clients, and `ctx.session.generate` in the V2 plugin context. Regenerate clients from the assembled `HttpApi`; do not edit generated files manually.

### 7. Build Recap As The First External Consumer

Implement recap outside Core using `session.generate`. The recap integration owns idle/focus policy, the recap prompt, stale-result suppression, output cleaning, and display. Core owns only session-authentic transient generation.

## Verification Laws

The implementation is complete when tests establish these laws:

1. **Request equivalence:** the durable runner's prepared request remains equivalent before and after extraction.
2. **Transcript immutability:** `session.generate` leaves Session messages and pending inputs unchanged.
3. **Instruction immutability:** transient generation does not advance instruction state or publish instruction events.
4. **Single attempt:** one call produces exactly one `llm.stream` invocation and no continuation.
5. **No tool execution:** advertised tool calls never reach tool settlement or tool hooks.
6. **Cache identity:** normal Steps and transient generation use the same Session-derived prompt-cache key.
7. **Hook parity:** Session request hooks see and may transform transient requests through the same preparation seam.
8. **Empty success:** a provider response with no assistant text returns `{ text: "" }`.
9. **Snapshot isolation:** concurrent Session advancement does not change an already prepared transient request.
10. **No accounting mutation:** transient usage does not alter durable Session cost or token totals.

## Rejected First Implementations

### Prompt, Wait, And Read

This path mutates Session History, enters the agent loop, may execute tools, and changes usage. Deleting projected messages afterward cannot undo durable events or external effects.

### Durable Fork With Cleanup

A fork is useful for a prototype but creates durable state, emits events, requires reliable deletion, and can execute tools unless the normal runner is changed anyway. It does not establish the reusable preparation seam.

### Session Calling Stateless Generate

`Generate.text` intentionally knows nothing about Session. Teaching it Session semantics reverses the intended dependency and duplicates request preparation outside the runner.

### A General `persist: false` Runner Mode

Persistence, tool execution, admission, compaction, and continuation are separate behaviors. One flag would leave callers responsible for understanding unsafe combinations and would keep the current concerns interleaved.

## Expected Scope

The narrow implementation is expected to touch Core Session and runner modules, Protocol, Server, generated clients, and the V2 plugin context. It should require no database migration and no new durable event.

The architectural work is larger than the endpoint. Most risk lies in extracting instruction and request preparation without changing normal Step behavior. The staged sequence keeps that risk observable and gives every new seam two real callers before broadening its interface.
