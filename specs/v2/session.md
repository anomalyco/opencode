# Session API

## Current V2 Core Slice

The Effect-native core facade treats prompt recording and execution as separate responsibilities:

```text
sessions.create({ id?, location, ... })
  -> omitted ID generates one internal Session ID
  -> supplied ID creates the Session when absent
  -> reused ID returns the existing Session identity

sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })
  -> omitted ID generates one internal message ID
  -> supplied ID inserts one durable Session inbox row when absent
  -> exact reuse returns the same admission receipt
  -> reusing one message ID for another Session, prompt, or delivery mode fails
  -> exact retry schedules another wake unless resume is false
  -> resume omitted or true schedules execution after admission
  -> resume false admits only

sessions.interrupt(sessionID)
  -> interrupts active execution on this process
  -> waits for runner cleanup and settlement
  -> clears a coalesced follow-up wake already registered with this coordinator
  -> preserves durable inbox rows for a later wake or resume
  -> idle or missing Session is a no-op

sessions.active()
  -> snapshots foreground Session drains owned by this process
  -> returns only active Session IDs with { type: "running" }
  -> absence means inactive; activity is not durable across process restarts
```

`session_input` is the durable admission inbox. `PromptAdmitted` records and projects accepted input so pending queue state can be replayed, replicated, and observed by clients. Admitted inputs remain outside model-visible Session history until the serialized runner publishes `Prompted`. Its projector atomically writes the visible user message and marks the inbox row promoted in the same event transaction. The V1-to-V2 shadow bridge publishes the same `Prompted` event for already-visible V1 prompts.

`admittedSeq` is the durable Session event sequence of `PromptAdmitted`. Clients may use the admission event to represent queued input before `Prompted` makes it part of visible conversation history.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.drain({ sessionID, force? })
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per step, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started tool fiber after provider-stream closure, and reloads projected history once before continuation. Promoting any new user input resets the selected agent's configured step allowance; multiple steers promoted at one boundary reset it once. Tool settlement events carry the owning assistant message ID because provider-local call IDs may repeat across steps. Before assembling a provider request, the runner durably fails any local tool still projected as `running` from a previous process with `Tool execution interrupted`; abandoned side effects are never silently replayed.

Projected hosted tools preserve call-side and settlement-side provider metadata separately so settlement and interruption recovery cannot erase continuation identifiers. Provider-native reasoning and provider metadata replay only while the historical assistant model matches the selected continuation model; after a model switch, visible reasoning text remains ordinary assistant text and provider-native metadata is omitted.

## Instruction Checkpoints

V2 Sessions persist the exact privileged instructions shown to the model. `InstructionCheckpoint` stores one immutable instruction baseline, its baseline event sequence, and a model-hidden `Instructions.Applied` record used to compare independently observed instruction sources. Instructions are only one part of Model Context: the runner separately assembles agent or provider system text, Session History, tool definitions, and step-local additions for each request.

The runner has no instruction registry. `loadInstructions` explicitly loads these producers concurrently and combines them in this fixed order:

1. Instruction built-ins, currently environment facts and the host-local date.
2. `InstructionDiscovery`, observing ambient `AGENTS.md` files.
3. Selected-agent available-skill guidance.
4. Reference guidance.
5. Selected-agent MCP guidance.
6. API-managed `InstructionEntry` values for the Session.

`Instructions.combine(...)` preserves that caller order and rejects duplicate namespaced source keys. Each source owns its typed observation, JSON codec, and pure baseline, update, and optional removal renderers.

The first complete observation initializes `InstructionCheckpoint` before any pending prompt becomes model-visible. If an initial source is temporarily unavailable, execution stops while the prompt remains pending and retryable. Every later step attempt also prepares instructions before input promotion. Changed instructions publish one durable chronological System message through `session.instructions.updated`, and that event commit advances `Instructions.Applied` atomically.

```text
Client            Runner                 Explicit producers       InstructionCheckpoint      Inbox / History       LLM
   │                 │                            │                          │                       │               │
   ├─ Admit prompt ────────────────────────────────────────────────────────────────────────────────▶               │
   │                 │                            │                          │                       │               │
   │                 ├─ Load instructions ───────▶                          │                       │               │
   │                 │                            │                          │                       │               │
   │                 ◀─ Combined sources ─────────┤                          │                       │               │
   │                 │                            │                          │                       │               │
   │                 ├─ Initialize or reconcile ────────────────────────────▶                       │               │
   │                 │                            │                          │                       │               │
   │                 ├─ Publish update + advance Applied atomically ───────────────────────────────▶               │
   │                 │                            │                          │                       │               │
   │                 ├─ Promote eligible input ────────────────────────────────────────────────────▶               │
   │                 │                            │                          │                       │               │
   │                 ├─ System text + instruction baseline + history + tools ──────────────────────────────────────▶
```

Agent and model selection are step-scoped. The runner selects the agent before loading agent-specific guidance; a switch admitted after the current boundary applies to the next step without restarting the current one. Changed guidance is admitted through `session.instructions.updated` while preserving the baseline. Model selection affects Model Context assembly but is not an instruction source and does not itself replace the instruction baseline.

A completed compaction causes the next physical attempt to rebaseline from current instructions. Temporarily unavailable sources are restated from the model's last applied belief where possible. A Session move resets `InstructionCheckpoint` so the destination Location initializes a complete baseline on its next run. Committed revert also resets the checkpoint.

```text
Session                      InstructionCheckpoint
   │                                   │
   ├─ initialize complete baseline ────▶
   │                                   │
   │                                   ├──────────────────────────────╮
   │                                   │ reconcile instruction update │
   │                                   ◀──────────────────────────────╯
   │                                   │
   ├─ completed compaction ────────────▶ rebaseline
   │                                   │
   ├─ move or committed revert ────────▶ reset
```

`InstructionDiscovery` observes ambient instructions as one ordered aggregate source. Ambient discovery canonicalizes traversal within the project root, reads global and upward-project `AGENTS.md` files, and honors `OPENCODE_DISABLE_PROJECT_CONFIG` for project files.

An unavailable observation preserves the previously applied value. A confirmed partial instruction removal emits the complete remaining aggregate with explicit supersession text; removing the final instruction emits a revocation message.

Current instruction follow-ups:

- Add configured and remote instruction sources with explicit precedence and removal semantics.
- Add durable post-crash continuation recovery for promoted or provider-dispatched work.
- Add explicit manual compaction on top of automatic request-budget compaction.
- Add operational metrics for observation latency, unavailable sources, contention, baseline size, and chronological-update growth.
- Consider watcher-backed per-file caching only if measurements show direct step-boundary observation is too expensive.
- Design any plugin-defined instruction contribution as an explicit runner composition boundary; do not reintroduce a registry implicitly.
- Add clustered Session execution ownership and stale-runtime fencing.

## Automatic Compaction

Before each step, the runner estimates the complete model-visible request and compares it with the selected model's context window minus absolute reserved headroom. The reserve is the greater of the requested/model output allowance and configured `compaction.buffer`. When the request exceeds that budget and older complete steps are available, the runner compacts before executing the pending step.

Compaction keeps the full transcript durable while replacing its active model representation with one hidden checkpoint containing a structured rolling summary and token-bounded serialized recent context. Provider-native assistant, reasoning, and tool messages never survive across the boundary, avoiding signature and encrypted-reasoning failures when the earlier prefix changes.

`session.compaction.started.1` durably identifies the attempt. Compaction deltas are live-only progress. `session.compaction.ended.1` durably stores the final summary and serialized recent context; only this completed event projects a model-visible compaction message. On the next physical attempt, the runner observes that completed compaction and directly renders a fresh instruction baseline through `InstructionCheckpoint`. A failed or interrupted attempt therefore leaves the previous history boundary active.

Repeated compactions update the previous structured summary with newly compacted messages. The runner then reloads projected history and executes the original pending step.

When a provider rejects a request as context overflow before durable assistant output or tool execution, the runner attempts one overflow-triggered compaction even when the local estimate did not predict pressure. A completed checkpoint rebuilds the same logical step with one remaining physical attempt. A second overflow, unavailable compaction, or overflow after durable output becomes the ordinary terminal failure; recovery never loops or replays partial side effects. Deterministic old tool-result pruning remains a separate follow-up.

## V1 Model Context Parity

This is the canonical checklist for Model Context still needed before the V2 runner replaces V1. Keep each behavior in its owning boundary rather than treating all model-visible text as durable Instructions. Update this table in the PR that changes a status.

Status: `complete` is usable in the native V2 path, `partial` covers only part of V1 behavior, and `missing` has no native V2 equivalent.

| Boundary                   | Behavior                                                                 | Status   | Remaining V2 work                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Durable Instruction Source | Environment facts and host-local date                                    | partial  | Keep selected provider/model identity in step request assembly rather than a stale Location-wide instruction value.                    |
| Durable Instruction Source | Global and upward project instructions                                   | partial  | Decide whether V2 also discovers legacy `CLAUDE.md` and deprecated `CONTEXT.md`.                                                       |
| Durable Instruction Source | Configured local/glob and remote URL instructions                        | missing  | Add independent sources with explicit precedence, unavailable, and removal semantics.                                                  |
| Durable Instruction Source | Nearby nested instructions discovered after successful reads             | missing  | Persist discoveries and admit them at the next safe step boundary.                                                                     |
| Durable Instruction Source | Selected-agent available skill guidance and skill-body loading           | partial  | Guidance and body exposure are permission-filtered; remove globally denied skill definitions during request-time tool materialization. |
| Step request assembly      | Placement, selected model, chronological history, and canonical lowering | complete | None.                                                                                                                                  |
| Step request assembly      | Selected agent, agent prompt, and effective permissions                  | partial  | V2 uses selected-agent permissions for skill guidance and tool authorization; still apply the agent system prompt and request policy.  |
| Step request assembly      | Provider/model-specific base instructions                                | complete | Native V2 selects the provider-family baseline unless the effective agent overrides it.                                                |
| Step request assembly      | Policy-filtered built-in, MCP, plugin, and structured-output tools       | partial  | Materialize definitions for the effective agent and request.                                                                           |
| Step request assembly      | Per-prompt system text and tool overrides                                | missing  | Design admission and durable replay semantics before exposing them.                                                                    |
| Step request assembly      | Steering, plan/build-switch, and final-step reminders                    | missing  | Add only reminders whose behavior remains part of V2.                                                                                  |
| Step request assembly      | Plugin message, system, parameter, and header transforms                 | missing  | Design V2 plugin hooks and lifecycle semantics.                                                                                        |
| Step request assembly      | Model variants and request settings                                      | partial  | Apply effective agent options and future plugin-mutated request settings.                                                              |
| Step request assembly      | Structured-output policy                                                 | missing  | Add prompt format, generated tool, tool choice, and model-visible policy together.                                                     |
| Step request assembly      | Automatic/context-pressure compaction                                    | complete | V2 initiates automatic and overflow-triggered compaction, then rebuilds the baseline from the completed checkpoint.                    |
| Prompt/reference expansion | Durable typed prompt attachments                                         | complete | None.                                                                                                                                  |
| Prompt/reference expansion | Native template and `@` mention expansion                                | missing  | Parse and resolve native V2 prompt input before durable admission.                                                                     |
| Prompt/reference expansion | File, directory, media, and MCP-resource materialization                 | partial  | Materialize and normalize sources instead of lowering unresolved attachment metadata.                                                  |
| Prompt/reference expansion | Agent-reference expansion                                                | missing  | Produce permission-aware model-visible task guidance.                                                                                  |
| Prompt/reference expansion | Configured-reference expansion                                           | missing  | Resolve aliases and emit durable model-visible reference context or failures.                                                          |
| Prompt/reference expansion | Native synthetic expansion replay                                        | partial  | V2 replays synthetic messages but only the V1 compatibility path creates them.                                                         |

Provider timeout, retry, and watchdog policy is intentionally deferred. The runner does not impose a universal provider-stream inactivity or absolute timeout. A future slice should design configurable policy around provider behavior, durable failure reporting, and local drain-chain release rather than hardcoding one default for every provider.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe step boundary, including continuation inside the current drain.
- `queue` inputs remain in a FIFO while the current drain requires continuation. When the Session would otherwise become idle, the runner promotes exactly one queued input, then reevaluates continuation before promoting another.

Execution has two entry points:

- `run` is an explicit resume. It joins any active execution or starts a forced drain while idle. A forced drain bypasses the no-eligible-input guard, but preparation may still fail before a physical attempt.
- `wake` reports newly recorded durable inbox work. Repeated wakes coalesce. A wake calls the provider only when it can promote eligible input.

Post-crash continuation recovery is intentionally deferred. A wake does not infer that ambiguous provider work is safe to retry after an input has already been promoted. Explicit `run` may deliberately continue from durable projected history. A future recovery slice should model provider-dispatch ambiguity, required continuation, queued-input promotion, retry policy, and visible recovery status together. It must not assume an enclosing durable execution identity that the Session model does not otherwise need.

A process-global `SessionRunCoordinator` serializes execution for each local Session while allowing different Sessions to run concurrently. Resumes join active execution, overlapping wakes coalesce into one follow-up, and interruption stops current process-local execution without deleting durable inbox work. The runner enters the Session's current Location when execution starts and fences each new step against that Location.

The coordinator's active registry is also the source for `sessions.active()`. It represents only foreground Session drains owned by the current process; background subagents and tasks do not add parent Sessions to this registry. The snapshot is runtime state and is empty after a process restart.

Inbox promotion coalesces pending steers in durable admission order. Once continuation would otherwise end, it promotes one queued input at a time in FIFO order. Add explicit inbox backlog and steering-batch limits before exposing broad multi-caller admission or untrusted queue growth.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per step. Before broadening exposure, revisit per-step call limits, output truncation, and operational backpressure using observed workloads. The normalized Session event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

The normalized Session event family and projected Session-message model predate this branch. This slice refines their replay contract: projected Session messages retain their source aggregate sequence so canonical context ordering and `sessions.messages(...)` pagination follow durable event order even when caller-supplied IDs differ; event time is carried by the envelope `created` field rather than duplicated in payloads. Consumers can use `sessions.log({ sessionID, after? })` to replay durable Session events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.log(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries.

`sessions.log(...)` captures the aggregate's durable watermark before replay and emits one `log.synced` marker when replay reaches that watermark. The marker carries `seq` when the captured watermark is non-empty and omits it when the log has no sequence. With `follow=true`, the tail subscribes before the replay watermark is captured, so events committed during replay are delivered after `log.synced` with a sequence greater than the marker watermark. Durable reads are paged internally; consumers observe only the ordered event stream plus the single marker.

`sessions.history({ sessionID, after?, limit? })` is the finite counterpart for request/response consumers. `after` is an exclusive aggregate sequence, and omission starts before sequence zero. The response is `{ data, hasMore }`; callers derive the next `after` from the final event's durable sequence when `hasMore` is true. Public durable Session events are selected before pagination, which permits gaps from private or historical aggregate events while preserving strictly increasing unique sequences. The log has a moving head, so events committed between pages may appear on the next page.

The finite endpoint is `GET /api/session/:sessionID/history`, uses the normal Session Location and authorization middleware, defaults to 50 events, and accepts at most 100. It returns only events in the public durable Session schema. The existing `sessions.log()` replay-and-tail stream is unchanged except for its explicit `log.synced` replay marker.

`sessions.history({ sessionID, after?, limit? })` is the finite counterpart for request/response consumers. `after` is an exclusive aggregate sequence, and omission starts before sequence zero. The response is `{ data, hasMore }`; callers derive the next `after` from the final event's durable sequence when `hasMore` is true. Public durable Session events are selected before pagination, which permits gaps from private or historical aggregate events while preserving strictly increasing unique sequences. The log has a moving head, so events committed between pages may appear on the next page.

The finite endpoint is `GET /api/session/:sessionID/history`, uses the normal Session Location and authorization middleware, defaults to 50 events, and accepts at most 100. It returns only events in the public durable Session schema. The existing `sessions.events()` replay-and-tail stream is unchanged.

Durable event tail wakeups are advisory and edge-triggered. Each active tail owns one sliding-capacity-1 dirty signal for its aggregate and re-queries SQLite after a wake. Repeated commits coalesce while the tail is busy because durable rows, not in-memory notifications, preserve every event and sequence. Subscribe and register the dirty signal before historical replay, then remove it when the tail closes, so replay handoff cannot miss a commit and inactive aggregates retain no wake state.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

Each Location-scoped `ToolRegistry` stores scoped tool registrations, materializes definitions, and owns lookup and settlement. Built-ins and plugins contribute through the same `Tools.Service.register(...)` path. Closing a contribution scope removes its definition and rebuilds the advertised catalog. Trusted tool executors capture and perform authorization; the registry applies catalog visibility filtering, decodes input, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

When a Session omits `agent`, both execution and permission evaluation use the default `build` agent. A caller must not observe `build` model behavior while permission checks silently evaluate an empty no-agent policy.

The first built-in contribution is bounded `read`:

```text
resolve one path relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> authorize read against the canonical resource identity
-> for a file: return UTF-8 text or base64 binary content; page oversized UTF-8 text by bounded line ranges
-> for a directory: return direct children in directory-first alphabetical order
-> page directory results with one-based offset and next cursor
```

V2 `bash` uses the normal permission semantics: configured agent rules plus saved project approvals, with `ask` as the default when no rule matches. Bash is not sandboxed: the spawned shell runs with the host user's filesystem, process, and network authority. Structured external `workdir` resolution remains an enforced `external_directory` authority check. Best-effort scans of absolute command arguments produce advisory warnings only; they are not sandbox boundaries and do not request or enforce `external_directory` approval.

The first V2 `apply_patch` leaf supports add, update, and delete hunks. It parses every hunk, resolves every mutation target, approves external directories, approves one edit batch, and preflights approved update/delete targets before committing operations sequentially. A later commit-time failure leaves earlier operations applied and returns an explicit partial-application report. Moves and atomic rollback remain separate follow-ups rather than implied behavior.

### Current Runner Follow-Ups

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after step consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Revisit additional covering indexes as larger-history query shapes become concrete.
- Design any global multi-Session event stream separately; the finite history API deliberately reads one authorized Session aggregate and does not change global Event publication.
- Decide whether UI-facing Session subscriptions should optionally interleave ephemeral deltas while connected without advancing the durable cursor.
- Add provider-aware context control for provider-executed tool results. Generic text truncation cannot replace provider-native structured payloads that must round-trip exactly.

## Remove Dedicated `session.init` Route

The dedicated `POST /session/:sessionID/init` endpoint exists only as a compatibility wrapper around the normal `/init` command flow.

Current behavior:

- the route calls `SessionPrompt.command(...)`
- it sends `Command.Default.INIT`
- it does not provide distinct session-core behavior beyond running the existing init command in an existing session

V2 plan:

- remove the dedicated `session.init` endpoint
- rely on the normal `/init` command flow instead
- avoid reintroducing `Session.initialize`-style special cases in the session service layer
