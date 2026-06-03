# V2 Schema Changelog

Record V2 database, durable-event, projected-message, HTTP, and generated SDK schema changes here. Each entry states why the contract changed and whether consumers or stored data need compatibility handling. Commit messages for schema-affecting changes should include the same summary.

This document covers meaningful contract changes introduced on the `feat/opencode-embedded-api` branch since its divergence from `origin/dev`. Mechanical file moves and internal refactors are omitted unless they changed stored data, replay behavior, public HTTP or SDK shapes, or model-facing tool contracts.

## Earlier Branch History

### Effect-Native Session Event Stream And Projection Schemas

Affected schema:

- New synchronized `session.next.*` event family in `packages/core/src/session/event.ts`.
- New projected V2 Session-message union in `packages/core/src/session/message.ts`.
- Internal replay cursor returned by `sessions.events({ sessionID, after? })`.

Change:

- Add durable Session events for agent and model switches, prompted user input, synthetic context, shell lifecycle, provider turns, assistant steps, complete text, complete reasoning, structured tool lifecycle, retries, and compaction.
- Keep text deltas, reasoning deltas, tool-input deltas, and live tool progress explicitly ephemeral.
- Add projected message variants for user, assistant, shell, compaction, synthetic, and switch records.
- Encode synchronized event payloads before writing JSON storage and decode them while replaying so schema transforms remain explicit at the durable boundary.

Reason:

- Embedded Session execution needs a replayable durable log and a derived chronological read model.
- Fragment streams are useful to connected renderers but must not advance durable cursors or inflate synchronized storage.

Compatibility:

- `session.next.*` schemas are experimental V2 contracts.
- Durable replay cursors are per-aggregate event sequences; ephemeral deltas are intentionally absent after reconnect.

### Deterministic IDs From External Keys

Affected schema:

- Session and Event ID construction helpers.

Change:

- Add deterministic `SessionSchema.ID.fromExternal(...)` and `EventV2.ID.fromExternal(...)` constructors for trusted external keys.

Reason:

- Embedded adapters need stable local identities when the same external conversation or stimulus is delivered more than once.
- Deterministic IDs let durable admission and event publication retain their idempotency boundaries across retries.

Compatibility:

- Existing generated Session and Event IDs retain their current prefixes and generation behavior.
- Deterministic constructors are additive internal helpers; public ID schemas remain strings with their existing prefixes.

### Durable Step And Outer-Turn Settlement

Affected schema:

- `session.next.step.ended` and `session.next.step.failed` synchronized event version `2`.
- New `session.next.turn.started` and `session.next.turn.settled` durable events.

Change:

- Bind step settlement to an explicit `assistantMessageID`.
- Record one outer provider-attempt marker and a terminal `completed`, `failed`, or `interrupted` outcome.

Reason:

- Provider-local call identifiers can repeat across turns.
- Runner recovery needs an explicit durable watermark for attempts interrupted after input promotion or before final settlement.

Compatibility:

- Step settlement uses synchronized event version `2` because the durable payload changed.
- Outer-turn events are additive experimental contracts.

### Durable Session Input Inbox

Affected schema:

- New `session_input` table from `20260603141458_session_input_inbox.ts`.
- Updated pending-input index from `20260603160727_jittery_ezekiel_stane.ts`.
- New `SessionInput.Admitted` schema and `Prompted.delivery` field.
- Prompt-admission conflict behavior in `SessionV2.prompt(...)`.

Change:

- Persist admitted prompts before projection with an autoincrement inbox sequence, unique message ID, Session ID, encoded prompt, `steer` or `queue` delivery mode, optional promoted event sequence, and creation time.
- Index pending inputs by Session, promotion state, delivery mode, and admission sequence.

Reason:

- Prompt admission and model-visible promotion must be separate durable operations.
- Steering must promote at safe provider-turn boundaries while queued prompts remain separate FIFO activities.

Compatibility:

- Database migration creates the inbox table and replaces its first pending index with a delivery-aware index.
- Exact prompt retries are idempotent; reusing a message ID for different input fails.

### Durable Session Projection Order

Affected schema:

- `session_message.seq` from `20260603040000_session_message_projection_order.ts`.
- Session-message and event indexes from `20260603001617_session_message_projection_indexes.ts`, `20260603040000_session_message_projection_order.ts`, and `20260603160727_jittery_ezekiel_stane.ts`.

Change:

- Add and backfill `session_message.seq` from matching synchronized events.
- Add event aggregate-sequence and aggregate-type-sequence indexes.
- Add Session-message sequence, type-sequence, and compatibility timestamp indexes.

Reason:

- Projected history, replay, compaction lookup, and pagination must follow durable aggregate order rather than timestamps or caller-generated IDs.
- Runner and HTTP read paths need covering indexes for their concrete lookup shapes.

Compatibility:

- Migration fails rather than inventing chronology if an existing projected Session message has no matching durable event.
- The timestamp compatibility index remains for legacy or transitional query shapes.

### Structured Tool Registry And Canonical Output

Affected schema:

- Core-owned typed tool registry contract.
- Canonical tool output content and structured settlement schemas.
- Canonical tagged tool file sources in `@opencode-ai/llm`.
- Durable tool called, progress, success, and failure events and projected assistant-tool states.

Change:

- Validate model input against each registered tool's parameter schema.
- Validate handler success against each tool's success schema before optional pure model-output lowering.
- Generate optional tool-definition output JSON Schema from typed success schemas.
- Persist canonical structured output and content for running, completed, and failed tools.
- Represent tool files explicitly as inline data, remote URL, or managed file URI sources rather than one ambiguous URI string.

Reason:

- Embedded tool execution needs one typed boundary between provider calls, local side effects, durable settlement, and replay.

Compatibility:

- These are additive experimental V2 runtime contracts.
- Tool results are durably settled before provider continuation.
- Legacy text, JSON, and inline-media results remain convertible; unresolved URL and file sources must be materialized or explicitly rejected before provider lowering.

### Managed Tool-Output Resources

Affected schema:

- New `ToolOutputStore.Resource` and `ToolOutputStore.Page` schemas.
- New `tool-output://<opaque-id>` URI contract.
- `read` tool resource-page input.

Change:

- Spill oversized model-facing tool text into Session-owned opaque managed resources.
- Page stored UTF-8 content by byte offset with bounded reads and explicit `truncated` and `next` metadata.

Reason:

- Tool results need bounded model context without discarding the full output.
- Opaque Session ownership prevents one Session from reading another Session's managed output.

Compatibility:

- This is an additive internal and model-facing resource contract.
- Managed output is retained for a bounded period and is not a public filesystem path.

### Location-Scoped Filesystem Read And Search Contracts

Affected schema:

- Core filesystem read, directory-list, root-resolution, and named-reference inputs.
- `LocationSearch.FilesInput`, `LocationSearch.GrepInput`, and bounded result schemas.
- `read`, `glob`, and `grep` tool parameters and success payloads.

Change:

- Add bounded file reads, paged directory listings, bounded glob results, and bounded grep matches with line previews.
- Allow named project references for read-oriented operations.
- Resolve and pin canonical approved search roots before traversal.
- Exclude hidden path segments from broad V2 glob and grep discovery.

Reason:

- Embedded tools need deterministic bounds and a shared path-containment authority.
- Broad search should not disclose hidden files implicitly.

Compatibility:

- These are additive V2 tool contracts.
- Hidden-file discovery is intentionally narrower than an unconditional ripgrep `--hidden` traversal.

### Location Workspace Identity

Affected schema:

- `Location.Ref.workspaceID`.
- V2 Location HTTP middleware routing.

Change:

- Brand optional Location workspace identity as `WorkspaceV2.ID` instead of an untyped string.
- Preserve nested `location[workspace]` and workspace-header routing inputs while decoding them into the branded identity.

Reason:

- Location-scoped services and embedded routing need one typed workspace identity boundary.

Compatibility:

- Existing workspace strings remain accepted when they satisfy the workspace ID schema.
- Generated OpenAPI reflects the workspace prefix constraint.

### Structured Mutation Authority And File Leaves

Affected schema:

- New `LocationMutation.ResolveInput`, planned target, external-directory authorization, and typed path errors.
- New `write` and exact `edit` tool schemas.
- New internal file-mutation commit service.

Change:

- Resolve relative mutation paths within the active Location.
- Accept absolute internal paths and require explicit `external_directory` approval before leaf approval for external absolute paths.
- Keep named references read-oriented and reject them for mutation.
- Revalidate path authority immediately before write mechanics.

Reason:

- Mutation tools need explicit capability escalation and symlink/path-swap checks without pretending path APIs provide a syscall-level sandbox.

Compatibility:

- These are additive V2 mutation contracts.
- Richer V1 fuzzy edit behavior remains intentionally deferred.

### V2 Permission Requests And Saved Rules

Affected schema:

- `PermissionV2.Request`, `AssertInput`, `ReplyInput`, source metadata, tagged errors, and lifecycle events.
- V2 permission list, reply, and saved-rule HTTP routes and generated SDK schemas.

Change:

- Add Location-scoped pending permission requests with `once`, `always`, and `reject` replies.
- Attach optional originating tool message and call IDs.
- Preserve authored ordered rules and saved approvals as separate inputs to evaluation.
- Establish action and resource conventions for `read`, `glob`, `grep`, `edit`, `external_directory`, `bash`, `todowrite`, and `webfetch` approvals.

Reason:

- Embedded tool calls need a Core-owned authorization boundary that can suspend and resume through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- V2 `bash` now requires an explicit exact-action authored `ask` or `allow` rule; catch-all and remembered approvals do not opt into shell authority.
- Policy authors should account for canonical resource forms; originating tool source metadata remains optional until every registry call carries its durable assistant owner.

### Initial Core V2 Built-In Tool Schemas

Affected schema:

- `read`, `glob`, `grep`, `write`, exact `edit`, `bash`, and `websearch` model-facing tool contracts.

Change:

- Add Core-owned Location-scoped built-ins with explicit parameter and success schemas.
- Bound bash output and timeout input, search result counts and previews, read sizes, directory pages, and websearch result/context controls.

Reason:

- Embedded runner launch requires a minimal typed tool set without importing legacy application orchestration.

Compatibility:

- These are additive V2 built-ins.
- Richer launch-follow-up leaves such as `apply_patch`, skill loading, task dispatch, and LSP remain separate slices.

### Bash Explicit Opt-In And Advisory Warnings

Affected schema:

- V2 bash enablement policy.
- Optional `warnings` in the `bash` tool success payload.

Change:

- Deny bash unless configured agent rules contain an exact-action matching `bash` rule with `ask` or `allow`.
- Prevent catch-all authored allows and remembered approvals from opting into shell authority.
- Return advisory warning strings when best-effort command-argument scanning detects external absolute paths; keep structured external `workdir` approval enforced.

Reason:

- A shell subprocess has host-user filesystem, process, and network authority. Token scanning cannot honestly provide containment.

Compatibility:

- Agents relying only on catch-all allows no longer execute bash.
- Consumers rendering bash success should tolerate optional warning strings.

### V2 Session HTTP And Generated SDK Contracts

Affected schema:

- V2 Session list, prompt, context, message-list, compact, and wait HTTP routes.
- V2 Location query routing fields.
- Generated OpenAPI and JavaScript SDK schemas.

Change:

- Expose embedded Session creation and read-side behavior over the experimental HTTP API.
- Accept optional prompt admission `id`, `delivery`, and `resume` fields so callers can request idempotency, steering or queue semantics, and durable admission without immediate execution.
- Keep message cursors opaque and preserve configured Location routing through both legacy flat and nested `location[...]` query parameters in the V2 SDK client.

Reason:

- Remote and embedded consumers need one generated contract while Location middleware remains compatible with current server routing.

Compatibility:

- These are experimental V2 routes.
- Prompt admission now returns a user-shaped admission receipt and may return a conflict error when one message ID is reused for different input.
- SDK Location GET rewriting preserves existing flat query behavior and adds nested compatibility parameters.

## 2026-06-03: Durable Session Message Pagination

Affected schema:

- Internal `SessionV2.messages()` cursor input.
- Opaque cursor payload returned by `GET /api/session/:sessionID/message`.

Change:

- Remove wall-clock `time` from the message cursor payload.
- Resolve the opaque cursor's projected message `id` to its stored `session_message.seq`.
- Apply page boundaries and ordering with durable per-session `seq` rather than `time_created` plus `id`.

Reason:

- Projected V2 message chronology is defined by synchronized Session-event order.
- Wall-clock timestamps may collide or move backwards, so they are not safe pagination boundaries.
- The list endpoint must agree with replay and context loading, which already order by durable sequence.

Compatibility:

- No database migration is required. `session_message.seq` and its session-scoped index already exist.
- The HTTP cursor remains opaque and existing cursors remain usable because they already carry the projected message `id`; older extra `time` data is ignored while decoding.
- No OpenAPI or generated SDK schema changes are required for this pagination correction.

## 2026-06-03: Public Provider And Model Catalog DTOs

Affected schema:

- Responses from `GET /api/provider`, `GET /api/provider/:providerID`, and `GET /api/model`.
- Generated `ProviderV2PublicInfo` and `ModelV2PublicInfo` SDK schemas.

Change:

- Replace internal catalog response schemas with explicit public DTOs.
- Remove provider request headers and bodies, API settings, custom enablement data, model request overrides, and variant request overrides from public responses.

Reason:

- Internal catalog records may contain credentials or provider-specific request material and must not cross the public HTTP serialization boundary.

Compatibility:

- Public V2 catalog responses intentionally expose fewer fields.
- Internal provider and model schemas remain available to the runtime.

## 2026-06-03: Durable Reasoning And Hosted Tool Replay Metadata

Affected schema:

- Durable `session.next.reasoning.started` and `session.next.reasoning.ended` events.
- Durable `session.next.tool.success` and `session.next.tool.failed` events.
- Projected assistant reasoning and settled tool message state.

Change:

- Add optional reasoning `providerMetadata`.
- Add optional durable tool `result` and project it into settled tool message state.

Reason:

- Provider continuation requires signed or encrypted reasoning metadata on later turns.
- Provider-executed hosted tool results must survive projection so replay can keep hosted calls and results inline in assistant content.

Compatibility:

- Added durable-event fields are optional so previously recorded experimental events remain decodable.
- Projected settled tool state gains model-facing result data when available.

## 2026-06-03: Projected Assistant Ownership And Full-Value Parts

Affected schema:

- Projected assistant text parts.
- Durable text and tool lifecycle boundaries.
- Projected assistant tool ownership.

Change:

- Preserve stable IDs on projected assistant text parts.
- Route durable tool projection updates through explicit owning `assistantMessageID` values rather than provider-local call IDs alone.
- Replay full-value text and tool-input end checkpoints while keeping fragment deltas ephemeral.

Reason:

- Provider-local tool call IDs may repeat across turns.
- Durable projection reconstruction must not depend on ephemeral fragments that disappear after reconnect.

Compatibility:

- Earlier experimental projected assistant rows without stable text IDs are not assumed replay-compatible.
- Current V2 histories reconstruct from durable full-value checkpoints.

## 2026-06-03: Location-Scoped V2 Questions

Affected schema:

- New `QuestionV2.*` domain schemas.
- New `question.v2.asked`, `question.v2.replied`, and `question.v2.rejected` events.
- New question list, reply, and reject HTTP routes and generated SDK schemas.

Change:

- Add schemas for pending requests, question options, ordered answers, and tool ownership metadata.
- Add `GET /api/question/request`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reply`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reject`.

Reason:

- Embedded V2 tool execution needs a Location-owned pending-question service whose suspended replies can be settled through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- No database migration is required because pending questions are intentionally in-memory Location state.

## 2026-06-03: Core-Owned Todo Update Event

Affected schema:

- Core-owned `SessionTodo.Info`.
- Global `todo.updated` event registration.

Change:

- Register the todo update event from Core session-todo ownership and expose the existing todo item shape to the Core V2 tool.

Reason:

- Embedded V2 `todowrite` execution needs Core-owned persistence and update publication without importing legacy application orchestration.

Compatibility:

- The todo table and public todo update event shape are preserved.
- No database migration is required.

## 2026-06-03: Added Core V2 Tool Schemas

Affected schema:

- New `todowrite` tool parameters and success payload.
- New `question` tool parameters and success payload.
- New `webfetch` tool parameters and success payload.

Change:

- Add a todo replacement-list tool using `SessionTodo.Info` items.
- Add a question tool using ordered `QuestionV2.Prompt` values and ordered answer arrays.
- Add an HTTP(S) fetch tool with explicit `text`, `markdown`, and `html` formats, bounded timeout input, and optional managed output resource metadata.

Reason:

- Embedded V2 execution needs Core-owned built-ins rather than imports from legacy application orchestration.
- Explicit schemas keep model-facing definitions, runtime validation, and durable tool settlement aligned.

Compatibility:

- These are additive Location-scoped V2 built-ins.
- No database migration or public HTTP API migration is required.

## 2026-06-03: Conditional File-Mutation Stale Error

Affected schema:

- New internal `FileMutation.StaleContentError` tagged error.

Change:

- Add a typed error carrying the mutation target path when an approved exact edit no longer matches the bytes at commit time.

Reason:

- V2 exact edits must fail rather than stale-clobber a concurrent cooperating write after permission approval.

Compatibility:

- This is an additive internal error contract.
- No database, HTTP, or generated SDK schema changes are required.

## 2026-06-03: Provider Stream Runtime Deadlines

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- New internal `SessionRunner.ProviderStreamTimeoutError` tagged error.

Change:

- Add a 60-second per-event inactivity timeout and a 10-minute absolute provider-stream deadline.
- Flush durable full-value fragment checkpoints before surfacing either timeout.
- Durably fail recorded unsettled local tools, publish the existing failed assistant-step payload, and settle the outer turn as `failed`.

Reason:

- A silent provider or a provider that dribbles fragments forever must not hold one Session drain chain indefinitely.
- Existing durable failure boundaries already express timeout settlement without changing synchronized event payloads.

Compatibility:

- No migration or generated artifact regeneration is required.
- Embedded runner callers may now receive `SessionRunner.ProviderStreamTimeoutError` when a provider exceeds runtime policy.

## 2026-06-03: Keyed Coalescing Durable Tail Signals

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal durable aggregate-tail wake delivery only.

Change:

- Replace the process-global unbounded aggregate-ID PubSub with one sliding-capacity-1 dirty signal per active tail and aggregate.
- Subscribe and register the signal before historical SQLite replay, then remove it when the tail closes.
- Re-query durable rows after each dirty edge and advance only by persisted aggregate sequence.

Reason:

- Wake notifications are advisory edges, not durable event payloads.
- Slow consumers should not retain an unbounded number of redundant wake IDs when one SQLite query can recover every committed row after their cursor.
- Per-tail signaling preserves independent cursors for multiple consumers of the same aggregate.

Compatibility:

- No migration, synchronized event version, OpenAPI, or SDK regeneration is required.
- `sessions.events({ sessionID, after? })` remains a replay-and-tail stream of every durable event in aggregate sequence order.

## 2026-06-03: Sequential V2 Apply Patch Tool

Affected schema:

- New Core-owned `apply_patch` model-facing tool parameters and success payload.
- New Core-owned pure patch hunk representation for add, update, and delete operations.

Change:

- Accept `{ patchText: string }` using the `*** Begin Patch` envelope.
- Return ordered applied-operation receipts carrying `type`, canonical `target`, and permission-facing `resource`.
- Resolve and approve every target before reading approved update/delete contents.
- Preflight update/delete correctness before committing operations sequentially.
- Report already-applied resources explicitly when a later commit fails.

Reason:

- Embedded V2 agents need reviewable multi-file edits without importing legacy application orchestration into Core.
- Sequential semantics are small and honest: they avoid claiming rollback or transactionality that path-based filesystem commits do not provide.

Compatibility:

- This is an additive model-facing V2 tool contract.
- Moves and atomic rollback are deliberately unsupported in the first slice and remain visible follow-ups.
- No database migration, durable-event version, public HTTP, OpenAPI, or generated SDK change is required.
