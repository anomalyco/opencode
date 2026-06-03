# Session API

## Current V2 Core Slice

The Effect-native core facade treats prompt recording and execution as separate responsibilities:

```text
sessions.create({ id?, location, ... })
  -> omitted ID generates one internal Session ID
  -> supplied ID creates the Session when absent
  -> reused ID returns the existing Session identity

sessions.prompt({ id?, sessionID, prompt, resume? })
  -> omitted ID generates one internal message ID
  -> supplied ID records one user-message projection when absent
  -> exact reuse returns that existing user message
  -> reusing one message ID for another Session, prompt, or non-user projection fails
  -> exact retry reuses the existing durable message and schedules another wake unless resume is false
  -> resume omitted or true schedules execution after recording
  -> resume false records only
```

Retry behavior uses ordinary Session and user-message projections. Do not add separate retry tables unless a concrete recovery workflow requires independent durable state.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.run(sessionID)
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per provider turn, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started settlement after provider-stream closure, reloads projected history once before continuation, and fails after 25 provider turns within one local drain activity only when work remains. Tool settlement events carry the owning assistant-message ID because provider-local call IDs may repeat across turns. Default steering uses durable watermarks: `Prompted` aggregate cursors record input arrival order, outer `Turn.Started({ promptCursor })` facts record the latest prompt visible before one provider request is assembled, and `Turn.Settled({ turnID, outcome })` records that the provider attempt plus every started local-tool settlement reached a terminal boundary. A location-scoped `SessionRunCoordinator` joins explicit resumes, coalesces prompt wakeups, and reruns a drain only when a wake raced with settlement. A prompt accepted during an active provider turn is therefore consumed by the next safe bounded turn; stale wakeups become no-ops after checking durable state, while an unsettled outer turn remains recoverable by a later wake or explicit resume. Different Sessions remain concurrent. Automatic startup discovery remains a future slice. Add explicit `queue` delivery later when callers need work held until the current activity settles. Durable multi-node ownership, stale-owner fencing, interruption controls, retry policy, and queued delivery remain future work.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per provider turn. Before broadening exposure, revisit per-turn call limits, output truncation, and operational backpressure using observed workloads. The `session.next.*` event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

Core persists synchronized Session events and exposes internal replay for projection reconstruction. Projected Session messages retain their source aggregate sequence so canonical context ordering follows durable event order even when caller-supplied IDs or timestamps do not. Consumers can use `sessions.events({ sessionID, after? })` to replay durable `session.next.*` events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.events(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers such as Discord publication. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries. Until that contract is designed, connected renderers can combine `sessions.events(...)` with direct EventV2 delta subscriptions.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

`ToolRegistry` is Location-scoped. Contributions are scoped replayable transforms: closing a contribution scope removes its definition and rebuilds the advertised catalog. Execution decodes input, optionally authorizes the call, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

The first built-in contribution is `read`:

```text
resolve one path relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> reject files larger than 50 KiB
-> authorize read against the canonical resource identity
-> return UTF-8 text or base64 binary content
```

The second built-in contribution is bounded `list`:

```text
resolve one directory relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> authorize list against the canonical directory identity
-> return direct children in directory-first alphabetical order
-> page the structured result with one-based offset and next cursor
```

### Current Runner Follow-Ups

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after provider-turn consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Add covering indexes for `(session_id, time_created, id)` and `(session_id, type, time_created, id)`.
- Add `event(aggregate_id, seq)` for ordered replay and history access.
- Expose replayable Session events over HTTP and the generated SDK where remote consumers need them.
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
