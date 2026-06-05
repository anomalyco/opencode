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

V2 Sessions persist the exact privileged System Context shown to the model. A Context Epoch owns one immutable baseline plus a model-hidden structured snapshot used to compare independently observed Context Sources. Environment facts, the host-local date, and ambient global/upward-project `AGENTS.md` files are the initial registered sources.

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

Model switches and completed compactions request lazy baseline replacement. A Session move clears the epoch so the destination Location must initialize a complete baseline before promoting more input. Epoch creation is fenced against the authoritative Session Location, preventing an old-Location runner from recreating stale privileged context after a concurrent move.

```text
Session                            Epoch
   │                                 │
   ├─ initialize complete baseline ──▶
   │                                 │
   │                                 ├─────────────────────────────────╮
   │                                 │ reconcile chronological update  │
   │                                 ◀─────────────────────────────────╯
   │                                 │
   ├─ request replacement ───────────▶
   │                                 │
   │                                 ├─────────────────────────────────────╮
   │                                 │ replace after complete observation  │
   │                                 ◀─────────────────────────────────────╯
   │                                 │
   ├─ clear after Location move ─────▶
```

Ambient project discovery canonicalizes and contains traversal within the project root and honors `OPENCODE_DISABLE_PROJECT_CONFIG`. An unavailable observation preserves the previously admitted value. A confirmed partial instruction removal emits the complete remaining aggregate with explicit supersession text; removing the final instruction emits a revocation message.

Current Context Epoch follow-ups:

- Add configured, remote, and nested instruction sources with explicit precedence and removal semantics.
- Add durable post-crash activity recovery for promoted or provider-dispatched work.
- Integrate actual automatic/context-pressure compaction with epoch replacement.
- Add operational metrics for observation latency, unavailable sources, contention, baseline size, and chronological-update growth.
- Consider watcher-backed per-file caching only if measurements show direct safe-boundary observation is too expensive.
- Expose plugin-defined Context Sources only after plugin reload and scoped cleanup semantics are designed.
- Add clustered Session execution ownership and stale-runtime fencing.

Provider timeout, retry, and watchdog policy is intentionally deferred. The runner does not impose a universal provider-stream inactivity or absolute timeout. A future slice should design configurable policy around provider behavior, durable failure reporting, and local drain-chain release rather than hardcoding one default for every provider.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe provider-turn boundary, including continuation inside the current drain.
- `queue` inputs form a FIFO of future activities. When the current activity settles, the runner promotes exactly one queued input to open the next activity. Multiple queued inputs remain separate activities.

Execution has two entry points:

- `run` is an explicit resume. It joins an active drain chain or starts one, and performs at least one provider attempt even when no input is eligible.
- `wake` reports newly recorded durable inbox work. Repeated wakes coalesce. A wake calls the provider only when it can promote eligible input.

Post-crash activity recovery is intentionally deferred. A wake does not infer that ambiguous provider work is safe to retry after an input has already been promoted. Explicit `run` may deliberately continue from durable projected history. A future recovery slice should model durable activity identity, provider-dispatch ambiguity, required continuation, queue-opener reservation, retry policy, and visible recovery status together.

A location-scoped `SessionRunCoordinator` serializes each Session drain chain while allowing different Sessions to drain concurrently. Automatic startup discovery, durable multi-node ownership, stale-owner fencing, interruption controls, and retry policy remain future work.

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
