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
transcript projection. `steer` inputs promote at the next safe provider-turn
boundary; `queue` inputs admitted during an active drain wait for the next fresh
drain. A location-scoped `SessionRunCoordinator` coalesces process-local wakeups
around settlement races.

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
- add compaction, queued delivery, interruption, retries, and stale-owner fencing
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

## Everything is hotreloadable - ???

Instead of needing to tear down things when something changes every service should emit granular events so services can react to them and reconfigure themselves. Allows frontend to receive these too, eg model.added. also prevents startup from blocking
