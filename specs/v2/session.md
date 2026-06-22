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
  -> supplied ID admits one durable Session input when absent
  -> exact reuse returns the same admitted lifecycle receipt
  -> reusing one message ID for another Session, prompt, or delivery mode fails
  -> exact retry schedules another wake unless resume is false
  -> resume omitted or true schedules execution after admission
  -> resume false admits only

sessions.interrupt(sessionID)
  -> interrupts the active ownership chain on this process
  -> waits for active drain cleanup and settlement
  -> suppresses reruns already queued before interruption
  -> preserves durable inbox rows for a later fresh wake or resume
  -> idle or missing Session is a no-op
```

`session_input` is the durable admission inbox. Admitted inputs remain outside model-visible Session history until the serialized runner publishes `PromptLifecycle.Promoted`. The projector atomically writes the visible user message and marks its inbox row promoted in the same event transaction. The legacy V1-to-V2 shadow bridge continues publishing ordinary `Prompted` events for already-visible V1 prompts.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.run({ sessionID, force? })
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per provider turn, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started tool fiber after provider-stream closure, reloads projected history once before continuation, and fails after 25 provider turns within one local drain activity only when work remains. Tool settlement events carry the owning assistant message ID because provider-local call IDs may repeat across turns. Before assembling a provider request, the runner durably fails any local tool still projected as `running` from a previous process with `Tool execution interrupted`; abandoned side effects are never silently replayed.

Projected hosted tools preserve call-side and settlement-side provider metadata separately so settlement and interruption recovery cannot erase continuation identifiers. Provider-native reasoning and provider metadata replay only while the historical assistant model matches the selected continuation model; after a model switch, visible reasoning text remains ordinary assistant text and provider-native metadata is omitted.

## Context Epochs

V2 Sessions persist the exact privileged System Context shown to the model. A Context Epoch stores one immutable provider-cache baseline and a model-hidden structured snapshot used to compare independently observed Context Sources. Environment facts, the host-local date, ambient global/upward-project `AGENTS.md` files, and selected-agent available-skill guidance are the initial sources. Location-wide sources come from the System Context Registry; selected-agent guidance composes with them immediately before Context Epoch admission.

The first complete observation initializes the epoch before any pending prompt becomes model-visible. If initial context is temporarily unavailable, execution stops while the prompt remains pending and retryable. On later provider turns, the runner promotes eligible input first, then reconciles current sources at the safe boundary. Changed context becomes one durable chronological System message, and its event commit advances the epoch snapshot atomically.

```text
Client            Runner                         System Context Registry       Context Epoch Store       Session History         LLM
   │                 │                                      │                           │                       │                 │
   ├─ Admit prompt ─────────────────────────────────────────────────────────────────────────────────────────────▶                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Observe initial context ────────────▶                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ◀─ Complete baseline or unavailable ───┤                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Initialize missing epoch ───────────────────────────────────────▶                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Promote eligible input ─────────────────────────────────────────────────────────────────▶                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Reconcile at safe boundary ─────────▶                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ◀─ Unchanged or chronological update ──┤                           │                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Advance snapshot atomically with update ────────────────────────▶                       │                 │
   │                 │                                      │                           │                       │                 │
   │                 ├─ Baseline + chronological history ─────────────────────────────────────────────────────────────────────────▶
```

Agent and model selection are provider-turn scoped. A switch admitted after the current safe provider-turn boundary applies to the next provider turn without restarting the current turn or replacing the baseline. Agent-specific skill guidance remains a Context Source, so changed guidance is admitted as a chronological System message. A completed compaction causes the next provider attempt to render a fresh baseline directly from current complete context. A Session move clears the epoch so the destination Location initializes a complete baseline on its next run.

```text
Session                            Epoch
   │                                 │
   ├─ initialize complete baseline ──▶
   │                                 │
   │                                 ├─────────────────────────────────╮
   │                                 │ reconcile chronological update  │
   │                                 ◀─────────────────────────────────╯
   │                                 │
   ├─ completed compaction ──────────▶
   │                                 ├─ render fresh baseline
   │                                 │
   ├─ clear after Location move ─────▶
```

Ambient project discovery canonicalizes and contains traversal within the project root and honors `OPENCODE_DISABLE_PROJECT_CONFIG`. An unavailable observation preserves the previously admitted value. A confirmed partial instruction removal emits the complete remaining aggregate with explicit supersession text; removing the final instruction emits a revocation message.

Current Context Epoch follow-ups:

- Add configured, remote, and nested instruction sources with explicit precedence and removal semantics.
- Add durable post-crash activity recovery for promoted or provider-dispatched work.
- Add explicit manual compaction on top of automatic request-budget compaction.
- Add operational metrics for observation latency, unavailable sources, contention, baseline size, and chronological-update growth.
- Consider watcher-backed per-file caching only if measurements show direct safe-boundary observation is too expensive.
- Expose plugin-defined Context Sources only after plugin reload and scoped cleanup semantics are designed.
- Add clustered Session execution ownership and stale-runtime fencing.

## Automatic Compaction

Before each provider turn, the runner estimates the complete model-visible request and compares it with the selected model's context window minus absolute reserved headroom. The reserve is the greater of the requested/model output allowance and configured `compaction.buffer`. When the request exceeds that budget and older complete turns are available, the runner compacts before executing the pending turn.

Compaction keeps the full transcript durable while replacing its active model representation with one hidden checkpoint containing a structured rolling summary and token-bounded serialized recent context. Provider-native assistant, reasoning, and tool messages never survive across the boundary, avoiding signature and encrypted-reasoning failures when the earlier prefix changes.

`session.next.compaction.started.1` durably identifies the attempt. Compaction deltas are live-only progress. `session.next.compaction.ended.2` durably stores the final summary and serialized recent context; only this completed event projects a model-visible compaction message. On the next provider attempt, the runner observes that completed compaction and directly renders a fresh Context Epoch baseline. A failed or interrupted attempt therefore leaves the previous history boundary active.

Repeated compactions update the previous structured summary with newly compacted messages. The runner then reloads projected history and executes the original pending turn.

When a provider rejects a request as context overflow before durable assistant output or tool activity, the runner attempts one overflow-triggered compaction even when the local estimate did not predict pressure. A completed checkpoint rebuilds the same logical provider turn with one remaining physical attempt. A second overflow, unavailable compaction, or overflow after durable output becomes the ordinary terminal failure; recovery never loops or replays partial side effects. Deterministic old tool-result pruning remains a separate follow-up.

## V1 Runtime Context Parity

This is the canonical checklist for model-visible runtime context still needed before the V2 runner replaces V1. Keep each behavior in its owning boundary rather than treating all model-visible text as a durable Context Source. Update this table in the PR that changes a status.

Status: `complete` is usable in the native V2 path, `partial` covers only part of V1 behavior, and `missing` has no native V2 equivalent.

| Boundary                   | Behavior                                                                 | Status   | Remaining V2 work                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Durable Context Source     | Environment facts and host-local date                                    | partial  | Add selected provider/model identity without making model selection a stale Location-wide value.                                       |
| Durable Context Source     | Global and upward project instructions                                   | partial  | Decide whether V2 also discovers legacy `CLAUDE.md` and deprecated `CONTEXT.md`.                                                       |
| Durable Context Source     | Configured local/glob and remote URL instructions                        | missing  | Add independent sources with explicit precedence, unavailable, and removal semantics.                                                  |
| Durable Context Source     | Nearby nested instructions discovered after successful reads             | missing  | Persist discoveries and admit them at the next safe provider-turn boundary.                                                            |
| Durable Context Source     | Selected-agent available skill guidance and skill-body loading           | partial  | Guidance and body exposure are permission-filtered; remove globally denied skill definitions during request-time tool materialization. |
| Per-turn request assembly  | Placement, selected model, chronological history, and canonical lowering | complete | None.                                                                                                                                  |
| Per-turn request assembly  | Selected agent, agent prompt, and effective permissions                  | partial  | V2 uses selected-agent permissions for skill guidance and tool authorization; still apply the agent system prompt and request policy.  |
| Per-turn request assembly  | Provider/model-specific base instructions                                | missing  | Select the provider-family baseline unless the effective agent overrides it.                                                           |
| Per-turn request assembly  | Policy-filtered built-in, MCP, plugin, and structured-output tools       | partial  | Materialize definitions for the effective agent and request.                                                                           |
| Per-turn request assembly  | Per-prompt system text and tool overrides                                | missing  | Design admission and durable replay semantics before exposing them.                                                                    |
| Per-turn request assembly  | Steering, plan/build-switch, and final-step reminders                    | missing  | Add only reminders whose behavior remains part of V2.                                                                                  |
| Per-turn request assembly  | Plugin message, system, parameter, and header transforms                 | missing  | Design V2 plugin hooks and lifecycle semantics.                                                                                        |
| Per-turn request assembly  | Model variants and request settings                                      | partial  | Apply effective agent options and future plugin-mutated request settings.                                                              |
| Per-turn request assembly  | Structured-output policy                                                 | missing  | Add prompt format, generated tool, tool choice, and model-visible policy together.                                                     |
| Per-turn request assembly  | Automatic/context-pressure compaction                                    | complete | V2 initiates automatic and overflow-triggered compaction, then rebuilds the baseline from the completed checkpoint.                    |
| Prompt/reference expansion | Durable typed prompt attachments                                         | complete | None.                                                                                                                                  |
| Prompt/reference expansion | Native template and `@` mention expansion                                | missing  | Parse and resolve native V2 prompt input before durable admission.                                                                     |
| Prompt/reference expansion | File, directory, media, and MCP-resource materialization                 | partial  | Materialize and normalize sources instead of lowering unresolved attachment metadata.                                                  |
| Prompt/reference expansion | Agent-reference expansion                                                | missing  | Produce permission-aware model-visible task guidance.                                                                                  |
| Prompt/reference expansion | Configured-reference expansion                                           | missing  | Resolve aliases and emit durable model-visible reference context or failures.                                                          |
| Prompt/reference expansion | Native synthetic expansion replay                                        | partial  | V2 replays synthetic messages but only the V1 compatibility path creates them.                                                         |

Provider timeout, retry, and watchdog policy is intentionally deferred. The runner does not impose a universal provider-stream inactivity or absolute timeout. A future slice should design configurable policy around provider behavior, durable failure reporting, and local drain-chain release rather than hardcoding one default for every provider.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe provider-turn boundary, including continuation inside the current drain.
- `queue` inputs form a FIFO of future activities. When the current activity settles, the runner promotes exactly one queued input to open the next activity. Multiple queued inputs remain separate activities.

Execution has two entry points:

- `run` is an explicit resume. It joins an active drain chain or starts one, and performs at least one provider attempt even when no input is eligible.
- `wake` reports newly recorded durable inbox work. Repeated wakes coalesce. A wake calls the provider only when it can promote eligible input.

Post-crash activity recovery is intentionally deferred. A wake does not infer that ambiguous provider work is safe to retry after an input has already been promoted. Explicit `run` may deliberately continue from durable projected history. A future recovery slice should model durable activity identity, provider-dispatch ambiguity, required continuation, queue-opener reservation, retry policy, and visible recovery status together.

A process-global `SessionRunCoordinator` serializes each local Session drain chain while allowing different Sessions to drain concurrently. It enters the Session's current Location only when a drain starts, so interruption targets process execution ownership rather than Location cache identity. Interruption establishes a local ownership-chain boundary by stopping the current chain while preserving pending/unpromoted durable inbox rows for a later fresh wake and projected history for explicit resume. A Location runner also fences every new provider turn against its captured Location so a moved Session cannot begin another turn through source-Location tools or context. An already-dispatched provider turn may still settle source-Location calls until a future move-control slice interrupts active ownership. Automatic startup discovery, durable multi-node ownership, stale-owner fencing, and retry policy remain future work.

Inbox promotion coalesces pending steers in durable admission order and opens one queued activity at a time in FIFO order. Add explicit inbox backlog and steering-batch limits before exposing broad multi-caller admission or untrusted queue growth.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per provider turn. Before broadening exposure, revisit per-turn call limits, output truncation, and operational backpressure using observed workloads. The `session.next.*` event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

The synchronized `session.next.*` event family and projected Session-message model predate this branch. This slice refines their replay contract: projected Session messages retain their source aggregate sequence so canonical context ordering and `sessions.messages(...)` pagination follow durable event order even when caller-supplied IDs or timestamps do not. Consumers can use `sessions.events({ sessionID, after? })` to replay durable `session.next.*` events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.events(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers such as Discord publication. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries. Until that contract is designed, connected renderers can combine `sessions.events(...)` with direct EventV2 delta subscriptions.

Durable event tail wakeups are advisory and edge-triggered. Each active tail owns one sliding-capacity-1 dirty signal for its aggregate and re-queries SQLite after a wake. Repeated commits coalesce while the tail is busy because durable rows, not in-memory notifications, preserve every event and sequence. Subscribe and register the dirty signal before historical replay, then remove it when the tail closes, so replay handoff cannot miss a commit and inactive aggregates retain no wake state.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

`ToolRegistry` is Location-scoped. Contributions are scoped replayable transforms: closing a contribution scope removes its definition and rebuilds the advertised catalog. Execution decodes input, optionally authorizes the call, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

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

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after provider-turn consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Revisit additional covering indexes as larger-history query shapes become concrete.
- Expose replayable Session events over HTTP and the generated SDK where remote consumers need them, deciding whether that public cursor should be opaque rather than the embedded API's branded aggregate sequence.
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
