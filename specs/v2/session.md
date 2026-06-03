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
  -> exact reuse returns the same user-shaped admission receipt
  -> reusing one message ID for another Session, prompt, or delivery mode fails
  -> exact retry schedules another wake unless resume is false
  -> resume omitted or true schedules execution after admission
  -> resume false admits only
```

`session_input` is the durable admission inbox. Admitted inputs remain outside model-visible Session history until the serialized runner promotes them by publishing ordinary `Prompted` events. The existing projector atomically writes the visible user message and marks its inbox row promoted in the same event transaction.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.run({ sessionID, force? })
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per provider turn, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started tool fiber after provider-stream closure, reloads projected history once before continuation, and fails after 25 provider turns within one local drain activity only when work remains. Tool settlement events carry the owning assistant-message ID because provider-local call IDs may repeat across turns.

Each provider turn has two runtime deadlines: a 60-second inactivity timeout reset by each provider event and a 10-minute absolute deadline for the full stream. Either deadline flushes complete durable text, reasoning, and tool-input checkpoints, durably fails any recorded unsettled local tools, publishes the existing failed assistant-step shape, settles the outer turn as `failed`, and releases the local drain chain. These deadlines are runtime policy rather than new durable-event fields.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe provider-turn boundary, including continuation inside the current drain.
- `queue` inputs form a FIFO of future activities. When the current activity settles, the runner promotes exactly one queued input to open the next activity. Multiple queued inputs remain separate activities.

Execution has two entry points:

- `run` is an explicit resume. It joins an active drain chain or starts one, and performs at least one provider attempt even when no input is eligible.
- `wake` reports newly recorded durable work. Repeated wakes coalesce. A wake calls the provider only when it can promote eligible input or recover an unsettled attempt.

Each provider attempt records `Turn.Started` before inbox promotion. `Turn.Settled({ turnID, outcome })` records completion after the provider stream and every started tool fiber settle. A later wake retries when the latest start has no matching settlement, including the crash window after promotion removed the input from the pending inbox but before request assembly completed.

A location-scoped `SessionRunCoordinator` serializes each Session drain chain while allowing different Sessions to drain concurrently. Automatic startup discovery, durable multi-node ownership, stale-owner fencing, interruption controls, and retry policy remain future work.

Inbox promotion coalesces pending steers in durable admission order and opens one queued activity at a time in FIFO order. Add explicit inbox backlog and steering-batch limits before exposing broad multi-caller admission or untrusted queue growth.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per provider turn. Before broadening exposure, revisit per-turn call limits, output truncation, and operational backpressure using observed workloads. The `session.next.*` event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

Core persists synchronized Session events and exposes internal replay for projection reconstruction. Projected Session messages retain their source aggregate sequence so canonical context ordering and `sessions.messages(...)` pagination follow durable event order even when caller-supplied IDs or timestamps do not. Consumers can use `sessions.events({ sessionID, after? })` to replay durable `session.next.*` events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.events(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers such as Discord publication. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries. Until that contract is designed, connected renderers can combine `sessions.events(...)` with direct EventV2 delta subscriptions.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

`ToolRegistry` is Location-scoped. Contributions are scoped replayable transforms: closing a contribution scope removes its definition and rebuilds the advertised catalog. Execution decodes input, optionally authorizes the call, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

The first built-in contribution is bounded `read`:

```text
resolve one path relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> authorize read against the canonical resource identity
-> for a file: reject content larger than 50 KiB, then return UTF-8 text or base64 binary content
-> for a directory: return direct children in directory-first alphabetical order
-> page directory results with one-based offset and next cursor
```

V2 `bash` is isolated behind a safe default. It is denied unless the selected agent's configured rules contain a matching exact-action `bash` rule with `ask` or `allow`. A remembered approval cannot enable bash by itself, and an authored catch-all allow rule does not count as explicit bash opt-in. Once opted in, bash is not sandboxed: the spawned shell runs with the host user's filesystem, process, and network authority. Structured external `workdir` resolution remains an enforced `external_directory` authority check. Best-effort scans of absolute command arguments produce advisory warnings only; they are not sandbox boundaries and do not request or enforce `external_directory` approval.

### Current Runner Follow-Ups

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after provider-turn consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Revisit additional covering indexes as larger-history query shapes become concrete.
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
