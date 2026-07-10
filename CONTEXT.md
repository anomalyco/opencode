# OpenCode Session Runtime

OpenCode sessions preserve durable conversational history while assembling the runtime context an agent needs to act correctly in its current environment.

## Language

**Model Context**:
The complete model-visible input assembled for one **Step**, including system instructions, **Session History**, tool definitions, and step-local additions. **Instructions** are one component of Model Context, not a synonym for it.
_Avoid_: System Context

**Instructions**:
The opaque algebra of independently refreshable typed instruction sources that render the durable instruction baseline and chronological updates shown to the model.
_Avoid_: Model Context, System Context

**Session History**:
The projected chronological conversation selected for a **Step** after applying the active compaction boundary and interleaving derived **Instruction Updates** from the current **Instruction Epoch**.
_Avoid_: Session Context

**Instruction Source**:
One independently read typed value within **Instructions**, represented by a stable namespaced key, canonical JSON codec, pure first/changed renderers, and an optional removal renderer.
_Avoid_: Prompt fragment

**InstructionEntry**:
One API-managed, durable, per-Session instruction value. Its slash-free client key maps to the `api/<key>` **Instruction Source** key. Entries deliberately render to the model as mechanism-neutral `<context>` blocks: the model sees session context, not how it was attached.

**InstructionDiscovery**:
The Location-scoped service that observes ambient global and upward-project `AGENTS.md` files as one ordered aggregate **Instruction Source**.

**Instruction State**:
The Session-owned projection cache of one instruction log fold: epoch start, values at that start, current values, and the last folded sequence. It is rebuilt from durable events and never authors model-visible facts.

**Instruction Update**:
A durable `session.instructions.updated` value delta admitted at a **Safe Step Boundary**. Its model-visible System text is rendered from stored values at request assembly and is never persisted verbatim.
_Avoid_: Correction, stored prose, raw text diff

**Initial Instructions**:
The deterministic instruction text rendered from values at the current **Instruction Epoch** start and sent as provider-cache prefix state until completed compaction moves the epoch or Session movement or committed revert resets it.
_Avoid_: Live system prompt

**Instruction Epoch**:
The span between completed compactions. Its start is the last `session.compaction.ended` sequence, or the initial complete instruction delta when no prior epoch exists.

**Instruction Values**:
The key-to-hash map produced by folding instruction deltas in durable sequence order. Hash bodies live once in the content-addressed instruction blob store.

**Unavailable Instruction Source**:
An expected temporary inability to read an **Instruction Source** value; the runtime retains its prior effective value and emits no update, while an unavailable source blocks the initial complete delta.

**Safe Step Boundary**:
The point during Step preparation, after prior tool settlement and before durable input promotion, where instruction changes may be admitted chronologically.

**Admitted Prompt**:
A durable user input accepted into the Session inbox but not yet included in **Session History**.

**Prompt Promotion**:
The durable transition that removes an **Admitted Prompt** from pending input and appends its user message to **Session History**.

**Step**:
One logical LLM call spanning pre-flight instruction synchronization, input promotion, request build, and compaction check; the provider stream; and tool settlement.
_Avoid_: provider turn, turn (unqualified)

**Physical Attempt**:
One actual provider request on the wire in service of a **Step**; most Steps have one Physical Attempt, while overflow-triggered compaction recovery may give one Step two.

**Assistant Turn**:
A reserved name for the not-yet-modeled unit containing all **Steps** from prompt promotion until the assistant yields the floor; do not reify it until something durable needs it.

**Settlement**:
The terminal transition for a unit of work: Step and tool settlement are durable, while drain and execution settlement are coordinator-observed.

**Execution**:
One session-scoped coordinator busy period from first wake until idle. An Execution is process-local coordination rather than a durable domain entity.

**Session Drain**:
One process-local execution span that promotes eligible input and runs required **Steps** until no immediate continuation remains. A Session Drain has no durable identity or transcript boundary.

**Model Tool Output**:
The bounded projection of a Core-executed tool result persisted in Session history and replayed to the model. A tool may shape this projection semantically, but the Tool Registry enforces the final size limit.

**Managed Tool Output File**:
A temporary file created under OpenCode's shared tool-output directory to retain complete output that was too large for Session history.

**Model Request Options**:
Provider-semantic model settings selected from the Catalog and active Session variant before the LLM protocol adapter encodes them for a provider request.
_Avoid_: Request body, wire options

**Generation Controls**:
Provider-neutral sampling and output controls, partitioned from provider semantics and compatibility wire fields when model metadata enters the Catalog.

**Native Continuation Metadata**:
Opaque protocol-shaped data attached to assistant content and required to continue that content natively with a compatible model, such as a reasoning signature or provider-hosted item identifier.

**PTY Environment**:
The host-supplied environment overlay applied by the server when creating a PTY, observed for the request Location and resolved PTY working directory.

**OpenCode Client**:
The generated Promise and Effect APIs derived from the public `HttpApi`; **Embedded OpenCode** shares the Effect API through an in-memory `HttpClient` against the same router and handlers.
_Avoid_: Remote client

**SDK Contract IR**:
The runtime-neutral compiled representation of the authoritative `HttpApi`, preserving encoded and decoded type projections plus transport metadata so independent SDK emitters can choose their public value model and runtime interpreter.

**Embedded OpenCode**:
A scoped in-process host that structurally extends the **OpenCode Client**, supplies an in-memory HTTP transport, and exposes additional same-process capabilities directly.
_Avoid_: Local implementation

**Page**:
A bounded ordered result containing `items` and opaque `previous` and `next` cursor links for navigating the same query in either direction.
_Avoid_: Response envelope

## Relationships

- **Instructions** is an opaque carrier composed from zero or more **Instruction Sources**.
- **Model Context** is broader than **Instructions**. For each **Step**, the runner assembles the selected agent or provider system text, **Initial Instructions**, **Session History**, available tools, and step-local additions into one model request.
- **Session History** persists conversational messages. The runner derives model-facing **Instruction Update** messages from value deltas and interleaves them by durable sequence; **Initial Instructions** remain separate provider-request state.
- The runner explicitly loads and combines instruction built-ins, **InstructionDiscovery**, selected-agent skill guidance, reference guidance, MCP guidance, and **InstructionEntry** values. There is no instruction registry.
- `Instructions.combine(...)` preserves caller order and rejects duplicate stable namespaced source keys. The runner loads its producers concurrently, then combines them in its fixed declared order.
- Each **Instruction Source** read returns one coherent typed value, explicit removal, or temporary unavailability. `Instructions.make(...)` hides the value type so differently typed sources compose uniformly; its canonical codec defines storage and hash equivalence, while pure renderers produce first, changed, and optional removal text.
- `Instructions.read(...)` reads every composed source concurrently and exactly once at the boundary. `Instructions.diff(...)` compares encoded-value hashes with current **Instruction Values** and returns one delta plus new blob bodies.
- `Instructions.renderInitial(...)` renders values at the **Instruction Epoch** start. `Instructions.renderUpdate(...)` renders one hydrated delta against the values immediately before it.
- A changed **Instruction Source** contributes its hash to one **Instruction Update**; explicit removal contributes the `"removed"` sentinel.
- An **Instruction Update** persists only its value delta. Rendered text is derived during request assembly and excluded from compaction summaries.
- The instruction blob insert, durable delta, and **Instruction State** advance commit atomically.
- Changes from multiple **Instruction Sources** admitted at one safe boundary combine into one **Instruction Update**.
- Instruction changes are sampled and admitted lazily at a **Safe Step Boundary**, never pushed asynchronously when their source changes.
- At a **Safe Step Boundary**, prior tool results are already settled; instruction preparation completes before newly admitted user input promotes.
- An **Admitted Prompt** is replayable pending input, not yet model-visible **Session History**.
- **Prompt Promotion** atomically consumes the pending inbox entry and appends its model-visible user message.
- Steering prompts promote at the next **Safe Step Boundary** while the current **Session Drain** still requires continuation. Promoting any newly admitted user input resets the selected agent's step allowance; multiple prompts promoted at one boundary reset it once.
- A queued prompt does not promote while the current **Session Drain** requires continuation. The runner promotes one queued prompt when the Session would otherwise become idle, then reevaluates continuation before promoting another.
- A **Session Drain** is process-local coordination rather than a durable domain entity. Durable recovery must reason from prompts, projected history, physical attempts, and tool state rather than inventing an enclosing execution identity.
- An **Execution** contains one or more **Session Drains**; a **Session Drain** contains one reserved assistant-turn span at a time; that span contains **Steps**; and each **Step** contains one or more **Physical Attempts** plus any tool calls it requires.
- A **Step** record covers only the model-visible span from first assistant output through tool settlement; pre-flight leaves no record, and one Step settles at most one record.
- The first **Step** admits one complete delta and renders **Initial Instructions** without narrating that delta in history; an unavailable initial source blocks the Step instead of persisting incomplete values.
- Instruction preparation precedes durable input promotion on every Step so an unavailable first baseline leaves pending input untouched and later updates enter history before newly promoted input.
- Completed compaction moves the **Instruction Epoch** to the exact `session.compaction.ended` sequence and copies current hashes to the epoch's initial values. Earlier updates leave active model history while durable deltas remain.
- A newly composed **Instruction Source** absent from current **Instruction Values** emits its first rendering once at the next **Safe Step Boundary**.
- **Unavailable Instruction Source** uses stale-while-revalidate semantics and is distinct from a successfully loaded absence, which may emit removal text.
- **InstructionDiscovery** observes ambient instructions as one ordered aggregate **Instruction Source**.
- Ambient discovery reads global and upward-project `AGENTS.md` files and honors `OPENCODE_DISABLE_PROJECT_CONFIG` for project files.
- After a successful internal file or directory read, nearby `AGENTS.md` files toward the Location root are injected once per Session as durable synthetic instruction messages.
- **InstructionEntry** stores API-managed per-Session JSON values. Each entry contributes one `api/<key>` **Instruction Source**, so adding, replacing, or removing an entry is reconciled at the next **Safe Step Boundary**.
- Location-scoped instruction producers naturally re-resolve when a moved Session next runs in its destination Location.
- Moving a Session clears its **Instruction State**, so the destination must admit a complete delta before another prompt can promote. Committed revert does the same; replay derives both resets from their durable events.
- Selected-agent available-skill guidance is an **Instruction Source** composed explicitly by the runner. It lists only names and descriptions permitted for that agent; skill bodies and locations are exposed only through the permission-checked `skill` tool.
- The selected agent and model are sampled when a **Step** starts. Changes admitted after that boundary apply to the next Step and do not restart the current Step.
- An agent switch that changes selected-agent guidance produces an **Instruction Update** while preserving the current baseline.
- Local tool authorization and pending permission requests retain the effective agent of the **Step** that issued the call; a later agent switch cannot change that call's policy.
- Instruction source changes never wake idle Sessions; the next naturally scheduled **Safe Step Boundary** loads and compares current values lazily.
- Once admitted, an **Instruction Update** remains durable even if the following **Physical Attempt** fails and is replayed unchanged on retry.
- **Instruction Updates** remain durable value history but are not `session_message` rows. Clients display changed keys rather than model-facing prose.
- The date **Instruction Source** initially preserves host-local calendar-date behavior; a configured user timezone may replace that default later.
- **Initial Instructions** are recomputed deterministically from durable values for every request; rendered bytes are not stored.
- A model/provider switch preserves current **Instruction Values**, the **Instruction Epoch**, and chronological conversation history; the new selection applies to the next **Step**.
- **Native Continuation Metadata** remains in durable history. Step projection includes it only for a successful exact originating provider/model match; failed Steps and incompatible models omit opaque metadata, while non-empty visible reasoning lowers to ordinary assistant text after a model switch. This conservative relation may widen only when recorded provider tests establish compatibility.
- **Model Request Options** remain provider-semantic through Catalog resolution. The Session runner maps them into the LLM package's provider-option namespace; the selected protocol adapter alone owns provider wire encoding.
- **Generation Controls**, protocol-semantic **Model Request Options**, and compatibility request body fields are separate Catalog domains. A shared ingestion adapter partitions legacy and models.dev AI-SDK-shaped options before routing.
- The **PTY Environment** is a server concern rather than a Core PTY concern. PTY creation merges caller values, then the host overlay, then Core-forced terminal invariants such as `TERM` and `OPENCODE_TERMINAL`.
- Networked and **Embedded OpenCode** use the same **OpenCode Client** and preserve the full HTTP encoding, routing, middleware, and decoding boundary; only the `HttpClient` transport differs.
- The Effect-native network constructor obtains `HttpClient.HttpClient` from its environment so callers own transport selection, recording, tracing, retries, and tests. Convenience runtimes may provide a fetch transport separately.
- Creating **Embedded OpenCode** is scoped. Closing its owning Scope releases the in-process server resources, database resources, registrations, and fibers.
- **Embedded OpenCode** exposes shared client capabilities and embedded-only capabilities on one object; consumers do not navigate through a nested `.client` property.
- The beta **OpenCode Client** currently uses plural consumer-facing capability groups such as `sessions`; whether the stable Session namespace should instead be singular `session` must be settled before stabilization. Internal server identifiers do not implicitly define public client names.
- Server's concrete `HttpApi` is authoritative for shared **OpenCode Client** capabilities. Codegen compiles its Session group directly; the Effect runtime uses an equivalent Protocol-only projection so generated artifacts remain independent of Core and Server.
- SDK generation reflects the public `HttpApi` once into an **SDK Contract IR**. Promise and Effect emitters share endpoint structure and transport metadata without being required to expose identical public values: an emitter may select encoded wire types, decoded domain types, compile-time brands, runtime validation, and its own execution abstraction independently.
- The first Effect emitter is the rich projection: it exposes decoded Effect-native values, preserves brands and schema transformations, performs runtime schema decoding, and delegates transport interpretation to `HttpApiClient`. Lighter wire-shaped Effect output remains possible through another emitter policy rather than constraining the shared IR.
- The rich Effect emitter regenerates private executable schemas when the **SDK Contract IR** proves that their transport semantics can be reproduced exactly. Contracts with authoritative custom transformations use the import-based Effect emitter against a Protocol-only client projection whose generated transport output is tested against Server's concrete API; the Promise emitter still derives zero-Effect structural wire types from the same IR.
- `@opencode-ai/protocol` owns Session endpoint construction and middleware placement. Server supplies concrete middleware keys to produce the authoritative build-time API; the client projection supplies transport-only keys without importing Core or Server at runtime.
- The first Promise emitter targets the same clean domain-oriented method organization rather than Hey API source compatibility. It returns unwrapped values directly, rejects declared and infrastructure failures, and begins with minimal client-level transport configuration; result wrappers, interceptors, and legacy generated signatures are outside the initial surface.
- The first Promise emitter parses response syntax and trusts its generated structural types; it does not perform runtime structural validation. Malformed payload syntax fails, while a syntactically valid shape mismatch is not detected at the SDK boundary. Standalone validator generation remains an optional future emitter policy.
- Declared Promise-client failures retain their tagged structural wire values and have generated type guards. Consumers do not depend on generated `Error` subclass identity, preserving discrimination across package copies and realms while remaining structurally aligned with Effect domain errors.
- Promise-client infrastructure failures use one generated `ClientError` class with a structured reason such as transport failure, unexpected status, unsupported content type, or malformed response. Promise methods reject with either a tagged declared domain failure or `ClientError`, matching the Effect client's conceptual domain/infrastructure error division.
- Promise methods accept a separate optional per-call transport-options argument containing `AbortSignal` and header overrides. Cancellation and transport metadata do not enter the domain input object; broader interceptor and response-mode APIs remain deferred.
- Promise streaming methods return a lazy `AsyncIterable` directly rather than a Promise-wrapped stream object. Iteration opens the connection, `AbortSignal` cancels it, and ending iteration closes the underlying request; the Effect emitter analogously returns `Stream` directly.
- Promise SSE connection establishment, declared HTTP failures, and infrastructure failures occur during `AsyncIterable` iteration, beginning with its first `next()` call, rather than during synchronous method construction.
- Neither generated streaming runtime automatically reconnects after disconnection. Promise `AsyncIterable` and Effect `Stream` fail explicitly; live consumers refresh and resubscribe, while durable sequence-based resume remains explicit composition above the generated client.
- Promise client construction is synchronous and network-free. It requires `baseUrl`, defaults to `globalThis.fetch`, accepts client-level headers, and merges them with per-call header overrides.
- Effect client construction accepts an explicit `baseUrl` and obtains `HttpClient.HttpClient` from the Effect environment. It does not install fetch or duplicate per-call transport policy; callers transform/provide the client for headers, tracing, retries, recording, and tests, while fiber interruption owns cancellation.
- Promise and Effect emitters each own their generated public type modules. The **SDK Contract IR**, not a physically shared generated type package, is the common source; this permits zero-Effect wire types and rich decoded Effect types to evolve independently.
- Promise and Effect network clients ship from `@opencode-ai/client` behind isolated root and `/effect` exports. The root has no runtime path to Effect; `/effect` imports only Effect, Schema, and Protocol.
- The Effect-native scoped host belongs to `@opencode-ai/sdk-next`, which will assume the existing `@opencode-ai/sdk` name after legacy consumers migrate. Client remains network-only and SDK depends one-way on Client.
- SDK executes Server's assembled `HttpRouter` in memory. It opens no listener and performs no network I/O, while preserving Server routing, middleware, codecs, handlers, and errors.
- The Effect Client and SDK re-export their decoded datatype facade from Schema so callers do not depend on internal package locations or Core's versioned names.
- A capability intended for both networked and **Embedded OpenCode** belongs in the authoritative public `HttpApi`; embedded-only same-process capabilities extend **Embedded OpenCode** separately.
- `sessions.log({ sessionID, after, follow })` is the public durable Session event stream. It verifies the Session, replays durable events after the optional aggregate sequence, optionally continues with newly committed durable events, excludes live-only fragments, and is transported as SSE in both networked and embedded modes.
- `events.subscribe()` is a distinct public instance-wide live stream for Session and non-Session activity. It has no replay guarantee and includes connection, heartbeat, and instance-disposal lifecycle events; consumers recover from disconnection by refreshing authoritative state.
- A Session ID is not an optional filter on `events.subscribe()`: instance-wide live events and durable Session events have different schemas, replay guarantees, cursors, lifecycle events, and failure behavior.
- The initial common OpenCode Client does not expose server-global event aggregation. `events.subscribe()` is bounded to the connected OpenCode instance or workspace; any future cross-instance administrative stream requires a separately designed API.
- `events.subscribe()` does not automatically reconnect after transport loss. The live-only stream fails with `ClientError`; consumers refresh authoritative state before explicitly opening a new subscription because events missed during disconnection cannot be replayed.
- `sessions.log({ sessionID, after, follow })` returns the generated HTTP client's cold durable event stream and does not build reconnection policy into the endpoint or client constructor. Transport loss fails the stream with `ClientError`. Callers may compose an explicit resuming stream above it by retaining the last observed durable sequence and opening a new subscription with `after`; any reusable resume helper remains a separate API design question.
- The stable `sessions.list(...)` design returns a **Page** in both networked and **Embedded OpenCode**; embedded execution does not define a separate unbounded array-returning list operation. The beta client currently preserves the existing HTTP `{ data, cursor }` envelope until emitter-level Page projection is implemented.
- Session list cursors are opaque branded values carrying continuation query and ordering state. Consumers pass them back unchanged and do not inspect storage anchors or encoded filter fields.
- A Session list continuation accepts only its opaque cursor. Scope, filters, ordering, and page size are fixed by the initial query and carried by that cursor.
- `sessions.messages(...)` returns a **Page** and uses the same cursor discipline as `sessions.list(...)`: the initial request supplies `sessionID`, ordering, and page size; continuation supplies `sessionID` plus only an opaque branded message cursor carrying ordering, page size, direction, and message anchor. Using a cursor with another Session is invalid.
- `sessions.message({ sessionID, messageID })` is a required resource lookup. An unknown Session fails with `SessionNotFoundError`; a known Session with an absent or differently owned message fails with `MessageNotFoundError` without disclosing cross-Session ownership. Absence is not represented as `undefined` across the public HTTP boundary.
- `sessions.interrupt({ sessionID })` first verifies that the durable Session exists, failing with `SessionNotFoundError` otherwise. For a known Session, interruption is idempotent: idle, already-settled, or locally unowned execution is a no-op.
- `sessions.active()` snapshots the current process's foreground Session drain registry as a record of Session IDs to `{ type: "running" }`. Missing IDs are inactive; background subagents and tasks do not make their parent Session active, and process restart clears the registry.
- `sessions.context({ sessionID })` preserves the existing message-only operation. It returns projected **Session History**; it does not include or represent the complete **Model Context**, whose agent system text, **Initial Instructions**, tools, and step-local additions remain separate.
- **Open question**: Should a future, separately named operation expose complete **Model Context**, including the instruction baseline, applied instruction metadata, tools, and step-local additions?
- `sessions.prompt(...)` exposes `resume?: boolean`. Omitting it preserves durable admission followed by an advisory execution wake; `resume: false` requests durable admit-only behavior.
- The public operation remains `sessions.prompt(...)`; `SessionPending.admit` is the internal primitive, while the public `Admission` result and `resume` option express its durable admission semantics.
- `sessions.create(...)` accepts an optional `location`. Omission resolves through the connected OpenCode instance's default or current location; an explicit value selects a known location. Networked and embedded transports use the same handler semantics.
- `sessions.switchAgent({ sessionID, agent })` is part of the common client alongside `sessions.switchModel(...)`. It affects subsequent Session activity and fails with `SessionNotFoundError` for an unknown Session.
- The **Embedded OpenCode** Layer delegates to the same scoped creation path; it does not define a second implementation.
- A **PTY Environment** adapter observes plugins in the request Location while passing the resolved PTY working directory to the hook; standalone servers use an empty adapter.
- An **Instruction Update** lowers to the provider's native chronological instruction role when supported and to a wrapped chronological fallback otherwise.
- When the aggregate discovered instruction set changes, its **Instruction Update** includes the complete current ordered set and supersedes the prior aggregate value; when no discovered instructions remain, the message states that previously loaded instructions no longer apply.
- Ambient project instruction discovery honors `OPENCODE_DISABLE_PROJECT_CONFIG`; global instructions remain eligible.
- Oversized textual **Model Tool Output** retains a bounded preview in Session history while its complete text moves to managed tool-output storage. Arbitrary structured-result size is a separate concern.
- One tool settlement receives one aggregate textual limit, using the configured maximum lines or UTF-8 bytes, whichever is reached first. The limit is provider-independent; token pressure belongs to context assembly and compaction.
- Generic truncation preserves the beginning and end of textual output. Tools may apply a more meaningful strategy before the Tool Registry enforces the final limit.
- A truncated **Model Tool Output** identifies its complete text in the bounded model-visible preview. The Tool Registry also supplies managed paths as internal metadata to tool hooks; Session events do not expose a typed `outputPaths` field.
- A **Managed Tool Output File** is temporary and may expire after its retention period. The bounded **Model Tool Output**, not the file, is the durable replayable record.
- Failure to retain a **Managed Tool Output File** fails settlement operationally. The Session never publishes a successful result whose complete output was lost during generic bounding.
- Once a tool operation succeeds, bounding its **Model Tool Output** and publishing its one durable settlement form an interruption-safe completion region. Raw oversized success is never published before a later correction.
- When a structured-only result would exceed the **Model Tool Output** limit, its validated structured value remains unchanged for Session consumers while model replay uses a bounded textual JSON preview and optional managed output path.
- Existing tool-managed output paths survive generic bounding. A fallback file retains exactly the complete projected text received by the Tool Registry and never claims to reconstruct output already discarded by tool-specific shaping.
- **Managed Tool Output Files** use globally unique names in one shared flat directory. They receive no special filesystem authority; each tool applies its ordinary external-path policy.
- Provider-executed tool results remain provider-native transcript facts outside generic Tool Registry bounding. Their context control requires provider-aware pruning or compaction because some providers require exact structured round-trip payloads.

## Client contract architecture

Semantic values that mean the same thing internally and publicly live in the lightweight Schema leaf. Core consumes Schema for domain behavior; Protocol composes Schema values into paths, payloads, envelopes, errors, cursors, and streams; Server imports both, hosts Protocol's exact groups, and owns protocol/domain adaptation. The root Promise client remains zero-Effect, `/effect` depends on Effect plus Schema and Protocol, and `@opencode-ai/sdk-next` composes the scoped in-process host above Client, Core, and Server.

Shared public records are plain objects declared with `Schema.Struct`. A same-name inferred interface gives object records readable TypeScript signatures without constructors, prototypes, or nominal identity; unions retain explicit type aliases.

Before stabilizing the client API:

- Keep additional public schemas in Schema and additional network groups in Protocol; neither package may transitively load databases, Drizzle, Session execution, providers, watchers, native modules, or WASM.
- Keep concrete Location middleware keys in Server while Protocol owns their placement. Client projections may supply transport-only keys, but must prove generated equivalence with Server's concrete API.
- Project the existing list response envelope to the stable client **Page** shape and enforce separate initial-query and cursor-continuation inputs without changing the hosted V2 wire contract.
- Settle the stable consumer namespace (`session` versus the current beta `sessions`) and use an explicit codegen annotation if the consumer name should differ from the server group identifier.
- Preserve V2 route paths, operation IDs, codecs, errors, middleware behavior, and OpenAPI output while making this change.
- Preserve browser-safe `@opencode-ai/client` and `@opencode-ai/client/effect` bundles through import-boundary tests.
- Define embedded-host placement before supporting multiple hosts over one database. Hosts that share durable Session storage must also share process-local Session execution coordination, or each host must receive isolated storage explicitly.
- Keep an embedded request scope alive until any streamed response body finishes. The initial non-streaming Session surface does not exercise this lifetime boundary; Session and instance event streams must do so before joining the embedded client.

## Example dialogue

> **Dev:** "The date changed while the session was active. Should the **Instruction Update** say what the old date was?"
> **Domain expert:** "No. Emit the newly effective date so the agent can act on the current instructions."

## Flagged ambiguities

- Legacy `experimental.chat.system.transform` can mutate assembled system text arbitrarily, but V2 plugins do not yet expose an equivalent hook. Decide separately whether to port it, model dynamic uses as explicit **Instruction Sources**, or narrow its semantics.
