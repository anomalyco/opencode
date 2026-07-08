# Plugin Readiness and Generation Lifetime

## Recommendation

Revise draft PR #35755 to expose one fixed-target readiness barrier. When Session execution reaches the barrier, it captures the current Config and SDK plugin revisions, waits until the Location has applied at least that revision pair, then continues without retaining an activation lock.

Immediately afterward, the runner resolves the selected agent and fails closed with `Session.AgentNotFoundError` if it is absent. This closes the empty-generation tool leak without claiming that a complete model step or request preparation is an immutable plugin snapshot.

Do not merge the current whole-step semaphore. It serializes Sessions and deterministically deadlocks a foreground subagent: the parent holds the Location semaphore while waiting for a child Session that needs the same semaphore.

Do not replace it with a preparation lock. Request hooks are arbitrary Effects that can reenter Sessions, and model resolution may perform credential/network work. Holding the Location semaphore across either can recreate deadlocks or block every Session.

Do not add generation leases in this PR. A correct lease design requires generation-local executable state or owner borrowing for tools, hooks, and AI SDK models. Effect supplies useful scope and reference-counting pieces, but no primitive can make the current shared mutable modules generation-isolated.

This document records the evidence, alternatives, and migration plan behind that recommendation.

## Problem

A Location becomes available before its initial plugin generation finishes activating. Session execution can therefore resolve an absent selected agent or materialize tools from incomplete plugin-owned state.

The original failure looked like this:

1. A Session selected `explore`.
2. Plugin activation had not installed the `explore` agent yet.
3. `AgentV2.select("explore")` returned an ID with no agent definition.
4. Tool materialization received `permissions: undefined` and advertised tools such as `shell`.
5. Tool execution later failed closed because permission evaluation could not find the agent.

Location eviction makes this more than a process-start race. Reopening an evicted Location reconstructs Location-scoped agent, catalog, hook, and tool state asynchronously.

SDK registration and Config updates add an ordering requirement: if an update commits before Session execution begins a flush, the barrier must apply at least the source revisions visible at that point before returning.

## Required Semantics

### Progressive Location startup

Location acquisition and TUI bootstrap must remain non-blocking. Plugin imports, provider discovery, and external setup must not become a prerequisite for first paint or unrelated filesystem operations.

### Session readiness

Before constructing a model request, Session execution captures the current Config and SDK plugin revisions and waits until the Location has applied at least that pair.

Readiness includes:

- plugin planning and module import
- top-level plugin setup
- initial agent, model, command, skill, hook, and tool contributions
- final Config projection plugins
- all tracked updates ordered before the captured target revision

Readiness excludes:

- future registrations
- arbitrary background fibers
- ongoing listeners
- MCP connection completion unless setup deliberately awaits it
- global process quiescence

### Readiness is a barrier, not a snapshot

The barrier guarantees that activation requests observed when the wait begins have completed before authoritative agent resolution starts. It does not freeze plugin-owned state after the barrier.

Config, SDK, and credential updates may occur immediately afterward. Current registries and caches retain their existing live-reload semantics. This PR must not claim coherent request or whole-step generations because the current shared mutable modules cannot provide them.

### Missing agents fail closed

After readiness settles, a missing selected agent must produce typed `Session.AgentNotFoundError`. It must not fall back to another agent, a generic system prompt, or unrestricted tool materialization.

### Failure and boundedness

The barrier must not hang forever on network-dependent activation. Existing optional-plugin import/setup failures may still be logged and skipped; selected agents and models fail closed if their required contribution is absent after the barrier.

## Implemented Design

Config and SDK plugin stores own their monotonic revisions:

```text
Config.revision()     increases when a discovered config snapshot commits
SdkPlugins.revision() increases when an SDK registration commits
```

State mutation and revision increment happen synchronously before the corresponding ephemeral event publishes. The event is only a wake-up notification for background activation.

`PluginSupervisor.flush` captures the source revision pair directly:

```text
target = {
  config: Config.revision(),
  sdk: SdkPlugins.revision(),
}
```

The supervisor serializes activation, applies current source state if its last applied pair does not cover the target, then returns. A delayed or missed Stream notification cannot make `flush` return early because correctness does not depend on event-consumer timing.

`SessionRunnerLLM` calls `plugins.flush` immediately before selected-agent resolution. It does not retain the activation semaphore during model resolution, hooks, streaming, or tool execution.

The OpenAI and OpenCode provider plugins await their initial refresh because completed initial activation must include its first catalog-discovery attempt. The complete OpenCode discovery operation, including credential resolution, has a 10-second timeout and no retry. Errors are logged and remote providers remain absent until a later connection refresh.

`PluginSupervisorNode` is not a new runtime module. The existing node definition moved out of `location-services.ts` so both the Location graph and `SessionRunnerLLM.node` can depend on it without a module import cycle.

## Current Strengths

- The initial empty-generation race is closed.
- Config and SDK revisions visible when `flush` begins are applied.
- Missing selected agents fail before model execution.
- Location acquisition and TUI startup remain progressive.
- The revision accounting is localized in the supervisor.

## Current Risks

### Location-wide serialization and nested-Session deadlock

The semaphore is held across provider streaming and tool execution. Different Sessions in one Location cannot execute model steps concurrently even though Session coordination otherwise permits that concurrency.

Foreground subagents make this a correctness bug, not only a performance cost:

1. A parent Session holds the Location semaphore while settling the subagent tool.
2. The subagent tool starts a child Session and waits for it to finish.
3. The child Session needs the same Location semaphore before its model step.
4. The parent waits for the child while the child waits for the parent-held semaphore.

### Delayed reloads

A long model call or tool execution prevents Config and SDK updates from activating. This is safe but potentially surprising and can make reload latency unbounded.

### Moving drain target

The activation loop drains until `applied === requested`. A continuous update stream can prevent every Session from starting. The contract cannot guarantee both bounded completion and inclusion of every event published before return. Synchronization needs a target revision captured when the wait begins.

### Remote work inside activation

Awaiting initial provider refresh makes catalog readiness truthful, but network and credential resolution now sit on the activation path. OpenCode fetch is bounded to 10 seconds; credential resolution is not separately bounded, and there is no transient retry policy.

### Forced full replacement

Config and SDK updates force replacement even when plugin IDs and versions compare equal. This is currently required for Config projections and same-ID SDK replacement, but it repeats all plugin setup and provider refresh work.

### Failure semantics

The registry currently logs and skips individual plugin setup failures. A generation can therefore be "complete" while configured plugins are absent. We need to distinguish optional plugin failure from failure of a required selected agent or model.

## Design Questions

1. Can Effect v4 model an atomic swappable scoped resource whose old scope closes only after all readers release it?
2. Does `LayerMap`, `RcMap`, `ScopedRef`, `Resource`, `Pool`, `Scope.fork`, or another Effect primitive already provide the required lease semantics?
3. Can tool materialization own everything needed for later settlement, removing the need to retain the plugin generation?
4. Can plugin scopes remain alive across replacement while domain state atomically switches generations?
5. Which executable contributions need owner borrowing if seamless hot reload becomes a product requirement?
6. What is the precise linearization point for Config and SDK updates?
7. Should synchronization drain updates that arrive during activation, or only the revision captured when synchronization begins?
8. How should concurrent Session readers interact with a writer without serializing each other?
9. How should activation failure affect the previous healthy generation?
10. What bounded retry policy, if any, should initial remote provider discovery use?

## Candidate Design Families

These are starting points for research, not recommendations.

### A. Semaphore pinning

Keep the current implementation. One writer/reader semaphore makes correctness obvious but serializes all readers.

### B. Read/write locking

Allow concurrent Session steps as readers and activation as an exclusive writer. This preserves generation pinning but a long reader still delays reload. Fairness and cancellation become part of the interface.

### C. Reference-counted generation lease

Activation builds a new scoped generation, atomically swaps the current pointer, and retires the old generation. Old scopes close after their active leases reach zero. Readers do not block one another, and reload does not wait for old model steps.

### D. Immutable materialization

Request construction snapshots stable agent/model/hook/tool values. Tool settlement calls captured handlers directly rather than checking current registry identity. Reload may close plugin scopes immediately only if captured handlers do not depend on those scopes.

### E. Stable registration cells

Tool and hook registrations use stable indirection cells whose implementation can be versioned or swapped. A request captures a version or cell lease. This may reduce whole-generation lifetime management but can move complexity into every plugin-owned domain.

### F. Admit-only readiness

Drain readiness only before request construction and accept stale-tool failures after reload as an explicit semantic. This is simplest, but likely violates the promise that an advertised tool remains callable during the step.

## Pressure Tests

Any accepted design must explain these paths:

1. Fresh Location, Session begins before initial activation completes.
2. SDK plugin B registers before or after a Session captures its target while generation A is activating.
3. Config update arrives before or after target capture while synchronization is waiting.
4. Two Sessions in the same Location execute long model steps concurrently.
5. Reload occurs while both Sessions hold tools from the old generation.
6. One old-generation tool runs for minutes after the new generation is active.
7. Plugin setup fails while a previous healthy generation exists.
8. The selected agent is removed by the new generation.
9. Remote provider discovery times out, then credentials change later.
10. A continuous stream of Config updates arrives faster than activation.
11. Location scope closes while activation, readers, or retired generations remain.
12. A Session is interrupted while holding a generation lease.

## Evaluation Criteria

The preferred design should:

- make the required ordering obvious at the interface
- allow concurrent Sessions in one Location
- close the initial and previously published activation ordering race
- avoid making stronger snapshot or executable-lifetime claims
- avoid blocking reload behind model streams or tools
- preserve interruption safety
- keep Location startup progressive
- bound network-dependent readiness
- centralize activation ordering in one deep module
- remain testable with deterministic activation barriers

## Research Findings

### Effect has no direct generation-swap primitive

Effect v4 has useful pieces, but no public primitive that atomically installs a prebuilt scoped replacement, allows concurrent readers to lease the old value, and closes the old scope after its final lease.

- `ScopedRef.set` closes the old scope before installing its replacement. Reads are not leases.
- `Resource` is built on `ScopedRef` and has the same replacement semantics.
- `RcRef` and `RcMap` preserve an invalidated resource until active scoped borrowers release it, but replacement is lazy and they do not provide an atomic current-generation pointer.
- `LayerMap` is a keyed `RcMap` wrapper, not an intra-Location generation manager.
- `Scope`, `Ref`, `Deferred`, `Effect.acquireUseRelease`, and a writer semaphore could implement a generation manager if one becomes necessary.

The correct custom lease design would build a candidate in a child scope, atomically publish it through a `Ref`, mark the previous generation retired, and close retired scopes after their reader count reaches zero. Readers would acquire and release through `Effect.acquireUseRelease`. This is implementable, but it is a substantial new lifecycle module.

### Whole-generation leasing does not fit the current state model

Plugin activation does not currently build one isolated generation object. It mutates shared Location-scoped agent, catalog, hook, tool, command, skill, and reference modules through `State.batch` and scoped registrations.

Retaining only an old plugin scope would preserve its resources, but new request reads would still use shared current state. A true whole-generation lease would require generation-owned snapshots or adapters for every plugin-derived module. Wrapping the current modules in a generation context would not make them isolated.

That design may eventually be valuable, but it is much larger than the readiness bug and would replace the current plugin state architecture.

### Per-registration leases are narrower but still invasive

Another viable design is to make materialized executable values retain their owning plugin scopes:

- capture tool handlers rather than rechecking the live registry
- capture tool hooks and AI SDK hooks
- retain the plugin owners backing those closures
- retire registration visibility immediately on reload
- close plugin scopes after all captured executable values release them

This permits concurrent Sessions and immediate reload, but old and new plugin listeners may coexist, and every executable contribution needs owner provenance. The public plugin contract permits closures over scoped resources, so simply copying handler functions without retaining owners is unsound.

### Existing stale-tool behavior is incomplete lifetime protection

`ToolRegistry.materialize` captures registration identities. Settlement compares that identity with the live registry and returns `tool.stale` when replacement completed before the check.

The check prevents many invocations of removed handlers, but it has a time-of-check/time-of-use window: reload may close the plugin scope after identity validation and before or during handler execution. Tool hooks may also change during one settlement. The readiness barrier neither solves nor depends on this behavior; executable lifetime needs separate work.

### A Location-epoch design is simpler but changes shipped behavior

The simplest possible design would activate plugins once per Location and require reopening the Location for SDK or plugin-topology changes. Ordinary Config projections could continue through their existing listeners.

This removes generation management entirely, but late SDK registration and live plugin code reload are existing behaviors with regression coverage. Changing them is a product decision, not an implementation simplification appropriate for this PR.

## Recommended Design

Use one **fixed-target readiness barrier**. Do not run caller effects while holding the supervisor semaphore.

The supervisor interface has one operation:

```ts
export interface PluginSupervisor {
  /** Apply at least every activation request observed when this Effect begins. */
  readonly flush: Effect.Effect<void>
}
```

Session execution uses it immediately before authoritative agent resolution:

```ts
yield * plugins.flush

const agent = yield * agents.select(session.agent)
if (!agent.info) {
  return (
    yield *
    new AgentNotFoundError({
      sessionID: session.id,
      agent: session.agent ?? agent.id,
    })
  )
}

// Existing live state and reload semantics apply from here onward.
```

Each call to `flush`:

1. Captures `{ config: Config.revision(), sdk: SdkPlugins.revision() }` when the Effect begins.
2. Acquires the per-Location activation semaphore.
3. If the applied revision pair does not cover the target, plans and activates from the current stores once.
4. Records the target pair and releases the semaphore.

The activation may include source state newer than the captured target. That is valid: `flush` promises a minimum revision pair, not an exact snapshot.

Background activation consumes the public event Stream only as a wake-up signal. Each event handler captures the current source revisions and applies through that fixed pair. Correctness never depends on Stream delivery timing.

### Readiness linearization

```text
source commit       -> mutate source and increment its revision
flush begins        -> capture Config and SDK revision pair
activation commit   -> record the pair covered by activation
barrier returns     -> applied pair covers captured pair
```

Updates committed before target capture are required. Updates committed afterward are not required for that wait, but may be coalesced by reading current source state.

This closes the issue's ordering paths:

- A fresh Location has no applied pair, so the first Session activates before resolving its agent.
- A reopened Location after eviction has a new supervisor and the same initial barrier.
- SDK registration and Config snapshot commits increment their source revision before publishing wake-up events.
- Continuous later updates cannot move an already captured target pair.

### No protected preparation callback

The supervisor must not expose `prepare(effect)`, `read(effect)`, or `withGeneration(effect)` in this PR.

Request hooks are arbitrary Effects and can start or await nested Sessions. Model resolution may refresh credentials over the network. Instruction loading may touch files, MCP state, and the database. Letting callers place this work under the activation semaphore recreates deadlocks and unbounded Location-wide serialization.

The barrier intentionally permits a reload immediately after it returns. This is the existing live-reload product behavior. The selected agent is still checked fail-closed, so the original absent-agent path cannot advertise unrestricted tools.

### Activation failure

Preserve existing optional-plugin behavior in this PR. Import and setup failures may be logged and skipped. Required selected resources fail at use:

- missing selected agent -> `Session.AgentNotFoundError`
- missing selected model -> existing model resolution error

Do not claim transactional activation or last-known-good fallback. Current activation closes old scopes before rebuilding shared state. A truthful transactional design requires isolated candidate state and is separate work.

### Remote provider discovery

Readiness and retry remain separate policies.

For this PR:

- await one bounded initial refresh so the first activation attempts to populate the initial catalog
- bound the entire OpenCode discovery operation, including credential resolution, not only the final HTTP fetch
- do not retry indefinitely inside activation
- allow later integration connection updates to refresh again

There is currently no retry in `fetchProviders` or `FetchHttpClient`. A follow-up may add one short retry for transient transport/5xx failures within the same total timeout. Authentication failures, schema errors, and ordinary 4xx responses should not retry.

## Why This Design

It closes the demonstrated readiness bug without making claims the current architecture cannot satisfy:

- Initial and previously published activation requests complete before agent resolution.
- Missing selected agents fail before model or tool materialization.
- Location startup remains progressive.
- Different Sessions do not hold a shared permit during model work.
- Foreground subagents cannot deadlock on the supervisor semaphore.
- Continuous updates cannot starve a captured wait target.
- No new Effect lifecycle abstraction is needed.

The module remains deep despite its one-operation interface: it hides synchronous update accounting, target capture, serialized activation, and initial boot behavior from every authoritative caller.

## Separate Hot-Reload Defects

The reviews found existing lifetime problems that the readiness barrier does not solve and must not obscure:

1. `ToolRegistry.settleWith` checks registration identity and then invokes the handler. Reload can close the plugin scope between the check and invocation.
2. Tool before/after hooks can cross generations during one settlement.
3. `AISDK.language` caches plugin-produced executable model objects without generation identity or invalidation.
4. Credential and Config projection listeners mutate shared Location state outside supervisor activation.
5. Activation failure destroys the prior healthy generation before skipping failed replacements.
6. Title and compaction model requests have their own readiness requirements.

These need separate product contracts and regression tests. Fixing them correctly may require per-registration owner borrowing, cache generation keys, or generation-local state. They are not reasons to retain a whole-step lock, and they are not solved by a preparation lock.

## Rejected Designs

### Whole-step semaphore

Rejected. It serializes Sessions, blocks reload behind long tools, and deadlocks foreground subagents.

### Preparation callback under the semaphore

Rejected. Arbitrary request hooks and model resolution can reenter Sessions or perform unbounded work.

### Read/write lock

Rejected. It still blocks reload behind the longest reader and introduces writer/read reentrancy hazards.

### Reference-counted whole generations

Deferred. It is internally coherent only after Agent, Catalog, permissions, hooks, and ToolRegistry become generation-addressable and immutable.

### Captured handlers without owner retention

Rejected as unsound. Plugin handlers and AI SDK models may close over scope-owned resources.

### Per-registration owner leases

Potential follow-up for seamless hot reload, but ownership provenance must cover tools, hooks, and AI SDK models.

### Location-epoch topology

Architecturally simple, but removes existing live SDK/plugin-topology reload and requires a product decision.

## Pressure-Test Results

1. **Fresh Location:** the initial target waits for initial activation.
2. **SDK update before target capture:** the barrier requires it.
3. **SDK update after target capture:** it is not required but may be coalesced.
4. **Config update before/after capture:** same minimum-revision semantics.
5. **Two long Sessions:** both pass the short barrier and stream concurrently.
6. **Foreground subagent:** parent holds no supervisor permit while waiting for the child.
7. **Continuous updates:** later revisions cannot move the captured target.
8. **Plugin setup failure:** optional failure behavior remains unchanged; selected resources fail closed.
9. **Agent removed after barrier:** existing live-reload race remains; the next authoritative resolution observes current state.
10. **Location closes:** normal scoped interruption applies; no Session-held supervisor lease exists.
11. **Session interruption:** no supervisor resource needs release after the barrier.
12. **Reload during tool/AI SDK execution:** explicitly outside this PR and covered by separate lifetime work.

## Migration From PR #35755

1. Remove `withGeneration` and the whole-attempt wrapper.
2. Keep `flush` as the sole interface operation.
3. Capture a fixed target when each synchronization or background reload Effect begins.
4. Change activation to apply through that target rather than drain a moving `requested` value.
5. Await `plugins.flush` immediately before selected-agent resolution in each model request path.
6. Keep typed missing-agent failure.
7. Bound the complete initial OpenCode provider discovery operation.
8. Revert runner changes added only to accommodate unavailable-tool continuation if they are unrelated to readiness.
9. Add production-layer tests for concurrent Sessions and foreground subagents.
10. Add fixed-target tests for before-capture, after-capture, and continuous updates.
11. Keep fresh-Location, eviction/reopen, embedded SDK first-Session, and missing-agent coverage.
12. Add separate follow-up issues/tests for tool settlement TOCTOU, AI SDK cache lifetime, transactional activation, title readiness, and compaction readiness.
13. Re-run the full core suite and update the PR body with the reduced contract.

## Final Recommendation

Revise PR #35755 to implement only the fixed-target readiness barrier and fail-closed selected-agent resolution. Do not merge either the whole-step lock or a protected preparation callback. Do not introduce generation leases in this PR.
