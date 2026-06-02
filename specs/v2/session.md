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
  -> exact retry returns before scheduling another resume
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

The local runner issues one explicit `llm.stream(request)` per provider turn, projects provider events durably, settles recorded local calls through the tool registry, reloads projected history before continuation, and fails after 25 model steps. It joins concurrent resumes for one Session in the current process while allowing different Sessions to run concurrently. Joining is not queued steering: a prompt recorded during an already-active run still needs an explicit pending-input continuation rule so it cannot be stranded when that run settles without local-tool continuation. Durable multi-node ownership, stale-owner fencing, interruption, retry policy, queued steering, and replayable consumer events remain future work.

Core already persists synchronized Session events and exposes internal replay for projection reconstruction. This is distinct from the missing consumer stream: replay durable events after a cursor, then tail live events without a race.

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

### Current Runner Follow-Ups

- Settle eligible recorded local tool calls with bounded concurrency after consuming one provider turn. Current settlement is serial and inline during provider-stream consumption.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Add covering indexes for `(session_id, time_created, id)` and `(session_id, type, time_created, id)`.
- Add `event(aggregate_id, seq)` for ordered replay and history access.
- Add replayable Session events: replay after a cursor, then tail live events without a race.

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
