# TODO

ok we need to work towards a launch of v2 so we can get out of this rebuild phase

## Post-Hono cleanup - Kit

The opencode server has moved to the Effect HttpApi backend. Remaining work is
mostly cleanup: delete compatibility shims, shrink Zod surfaces, and simplify
test harnesses that used to compare Hono and HttpApi behavior.

## New Data Mode - Dax

This is mostly done. I'm working through modeling subagents, skill invocations
and shell commands.

## Rework agent loop - Kit?

The first Effect-native local runner slice is implemented without bridging
through legacy `SessionPrompt.loop(...)`:

- process-global `SessionExecution.resume(sessionID)` discovers Location from
  the Session read model
- cached Location-scoped `SessionRunner` resolves one supported catalog model
  and issues one explicit `llm.stream(request)` provider turn at a time
- durable V2 projections record text, reasoning, provider failures, tool calls,
  tool results, and assistant output
- a scoped `ToolRegistry` advertises definitions and the first permission-checked
  `read` built-in
- local continuation reloads projected history and stops after 25 provider turns within one local drain activity
- concurrent resumes for one Session join one process-local run while different
  Sessions remain concurrent

Prompt admission now uses a durable `session_input` inbox rather than immediate
transcript projection. `steer` inputs coalesce into the active activity at the
next safe provider-turn boundary. `queue` inputs form a FIFO of future activities
that open one at a time. A location-scoped `SessionRunCoordinator` coalesces process-local wakeups
around settlement races. Explicit `run` resumes perform at least one provider
attempt; advisory `wake` notifications call the provider only for eligible inbox
work or an unsettled durable attempt. Steers coalesce into the active activity at
safe provider boundaries; queued inputs open later activities one at a time in
FIFO order.

Next reviewed slices:

- preserve eager structured local-tool settlement: durably record each complete
  call, start its child execution immediately, await every settlement after the
  provider turn closes, then reload projected history once
- revisit per-turn tool-call limits, output truncation, and operational
  backpressure before broadening exposure; eager local execution is deliberately
  unbounded in the current local slice while SQLite publication stays serialized
- remove the public in-memory `@opencode-ai/llm` tool loop after replacing its
  remaining one-turn native-adapter use with a narrow typed dispatcher
- batch streamed deltas and add covering context indexes
- expose replayable Session event cursors over HTTP and the generated SDK where remote consumers need them
- add compaction, interruption, retries, and stale-owner fencing
  only as their slices become concrete

## Rework compaction - Aiden?

The new agent loop needs to trigger compaction properly

## Plugin API design - James?

We need to figure out how we want server plugins to work and what hooks are useful.

Some ideas:

- plugins get immer drafts so bad mutations can be thrown away
- plugins get global "opencode" instance like in that post i showed
- opencode instance has stuff like `opencode.session.prompt()` or
  `opencode.tool.register({...})`

## Rework Config - ???

We should do another pass on config to clean up any mistakes we made with it and
simplify as much as possible. Old configs should get auto-converted to new

## Auth - ???

I have a basic auth system that can track any kind of auth, not just providers

## Model Database - ???

I have a basic model service that allows for models to be registered dynamically

## Provider - ???

Providers should register as plugins and autoload based on whatever logic they
want / config. They should register models into model database

## Event - Kit

The self-contained durable `EventV2` core service is implemented. It owns
sync-versioned persistence, transactional sequencing, pub/sub, replay, and
replay-owner claims without relying on the old bus system.

Remaining slices:

- expose the embedded consumer-facing Session cursor API over HTTP and the
  generated SDK where remote consumers need it
- keep replay-owner claims distinct from future clustered Session execution
  ownership and stale-runtime fencing

## Deferred hardening cleanup

Keep these visible, but do not block functionality slices on them unless a concrete
failure appears during canary work:

- serialize database migration claiming across processes; current migration
  application is protected only by an in-process semaphore, so two processes
  starting against one SQLite database can still race
- simplify process-local durable-tail wake lifecycle with Effect `RcMap` and one
  shared `PubSub.sliding<void>(1)` per active aggregate; keep SQLite cursor replay
  and subscribe-before-history semantics unchanged
- page large durable aggregate replay reads instead of loading every row after a
  stale cursor into one array
- decide whether connected tails need a periodic polling fallback for
  cross-process SQLite writers; current advisory wakes are intentionally
  process-local
- stream-cap websearch body collection before parsing
- add ripgrep execution timeout and bounded line framing
- validate managed tool-output payload size during reads and cleanup
- materialize or consistently reject unresolved URL and file attachment sources
- decide whether to preserve deprecated `@opencode-ai/llm` orchestration exports
- preserve or alias renamed filesystem SDK generated type names if compatibility
  consumers require them
- revisit syscall-level mutation confinement for hostile external processes
  (`openat`, `O_NOFOLLOW`, and descriptor-relative mutation where supported)

## Everything is hotreloadable - ???

Instead of needing to tear down things when something changes every service should emit granular events so services can react to them and reconfigure themselves. Allows frontend to receive these too, eg model.added. also prevents startup from blocking
