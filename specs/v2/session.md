# V2 Session Contract

Status: **Current semantic overview.** Protocol owns public operations, Schema owns public shapes and durable events, and Core owns execution and persistence behavior.

## Prompt Admission Precedes Execution

`Session.prompt(...)` publishes one durable `session.inbox.enqueued` fact whose projection inserts one `session_inbox` row before advisory execution begins. An inbox item remains outside model-visible Session History until delivery. The `session.inbox.delivered` projection consumes the row and inserts a visible user or synthetic message atomically; compaction and move control items are consumed without becoming transcript messages.

Reusing a Session ID adopts the existing Session. Reusing a user or synthetic inbox item ID is idempotent when Session and type match: the first admission wins, and retried payload, metadata, and delivery are ignored. After delivery, retry reconciliation uses the projected message and does not require enqueue history. Cross-Session and cross-type reuse fail. Compaction and move controls retain operation-specific conflict behavior.

`resume` controls scheduling, not durability:

- Omitted or `true` records the input, then schedules `SessionExecution.wake(sessionID)`.
- `false` records the input without scheduling execution.

Delivery is explicit:

- `steer` is the default. Steers deliver in enqueue order at the next Safe Step Boundary. Delivery stops before a compaction or move control item.
- `queue` remains pending while the Session can continue. At an idle boundary, steers still take priority; otherwise one queued item delivers, followed by any steers that arrived during delivery. The runner then reevaluates continuation before another queued item.

Promoting new user input resets the selected agent's step allowance. A batch of steers resets it once.

Manual compaction and Session movement use the same inbox as control items. Each request has its own inbox identity and delivery mode. A control item forms a delivery boundary so later steers do not cross it.

## Session Operations Own Admission Policy

Core's ID-addressed Session facade delegates prompt, synthetic, compaction, pending-input, shell, revert, execution controls, renaming, agent/model selection, viewed acknowledgements, and message lookup/editing to the ID-bound Session values in `session/session.ts`. Those operations own request idempotency, admission ordering, wake policy, and per-Session state-change rules. The facade supplies lazy Location services; the lower operations do not depend on `LocationServiceMap` or call back into the facade. Collection operations and host-infrastructure routing remain in the facade. Project resolution persists the owning Project; Session does not repeat that write.

The host acquires `Session.make` once within its host `Scope`, then selects ID-bound values through `forSession`. The factory captures that Scope for shell completion recording; it must outlive individual callers. The existing facade remains the Effect service; the lower factory does not introduce a second service or a Layer per Session ID.

```ts
Effect.gen(function* () {
  const sessions = yield* Session.make((ref) => locations.get(ref))
  const session = sessions.forSession(sessionID)
  yield* session.prompt({ text: "Inspect the failing tests", resume: false })
})
```

References share operation implementations, host services, and the existing execution coordinator. A Session value retains its ID, not a cached projection or permanently selected runner. Obtaining or discarding a value does not start or interrupt execution. Admission stays independently callable while execution is active.

User shell commands start immediately as background work without waiting for model execution or other user shells. They do not suppress prompt wakeups. The shell operation forks completion recording into the captured host Scope with `startImmediately: true` and joins that fiber, so caller cancellation does not cancel recording; closing the host Scope does. Shell started and ended events retain output in one shell entry. Completion and startup-failure notifications are admitted as synthetic input with `resume: false`, without waking execution. Shell services are resolved at startup, while Session events remain outside that Location context so movement does not pin them to the old Location.

Location services are acquired only when an operation needs them. In particular, retry reconciliation happens before prompt preparation, so an already-admitted input skips hooks and attachment resolution. Execution continues to resolve placement independently at drain start and after movement.

`servicesFor` selects instance services from the saved placement. Each instance constructs `SessionPrompt.Service`, whose `prepare` method turns submitted input into a user inbox item without admitting it, committing a revert, or waking execution. It captures FSUtil, PluginSupervisor, PluginHooks, Image, and Skill; readiness is checked before hooks on every call. Prompt keeps early retry reconciliation outside preparation and invokes preparation interruptibly in the current instance. Lower Session does not depend directly on Database or FSUtil; its Location requirements are SessionPrompt, SessionRevert, Shell, and the PluginSupervisor still used by manual shell startup.

Each instance constructs its `SessionRevert.Service` through `SessionRevert.make`, capturing Database, Bus, PluginSupervisor, and Snapshot. Stage and clear check plugin readiness on each invocation and require no service provisioning inside their implementations. Session methods select the current instance for each operation, so an ID-bound Session does not retain a previous instance's snapshots after movement. Commit uses the host's captured Bus and SessionStore and does not acquire an instance.

Before restoring files, `session.revert.prepared` records a previously unrecorded original snapshot and newly protected paths. Its private `revert_pending` projection survives failed restores or diffs; retries and clear include those paths without treating partial restoration as the original. Only successful staging changes the public revert boundary. Staged, cleared, and committed events retire pending protection. Committing failed preparation without a staged boundary clears protection without touching files or deleting history. New user and manual-compaction inbox admissions retire that protection atomically with admission; retries and synthetic notices do not accept it. Synthetic notices stay admitted without waking execution while preparation is pending, matching staged-revert behavior.

`SessionInbox.Service` is host-scoped. Its node depends on Database and Bus, and its layer uses `SessionInbox.make` to capture those services and construct admission and pending-input commands that take only domain inputs. Its `list` method supplies the normal pending-input read without exposing Database to Session. `Session.make` and the facade's move admission consume the registered service rather than constructing separate command objects. The service is not Session-ID scoped and does not own execution. Its commands retain the existing shared inbox serialization lock. Standalone query helpers, transaction-facing projectors, and runner delivery retain their explicit database/Bus inputs. The layer compiler is unchanged.

Inbox commands own identity and type checks and return typed `SessionInbox.LifecycleConflict` errors. Session operations translate these into their public operation-specific errors and decide whether to wake execution. The Bus/projector boundary still uses defects to abort invalid projections; Inbox translates only lifecycle conflicts, not unrelated defects. Pending-input mutation does not schedule execution itself: steering wakes after a successful mutation, while queueing and cancellation do not.

## Execution Is Process-Local

`SessionExecution` is process-global and keyed only by Session ID. At drain start it loads the Session, enters its Location through `LocationServiceMap`, and invokes the Location-scoped runner. The runner, model resolution, tools, permissions, plugins, and filesystem remain Location-scoped.

`SessionRunCoordinator` provides the local ownership rules:

- Explicit resumes join the active execution for the same Session.
- Repeated wakes coalesce into one follow-up drain.
- Different Sessions run concurrently.
- Interruption stops locally owned execution without deleting pending input.

The public interrupt operation verifies that the durable Session exists. An unknown Session fails with `SessionNotFoundError`; a known Session that is idle, settled, or not locally owned is a no-op.

`sessions.active()` snapshots busy periods currently owned by this process. Durable execution events and claims are historical and recovery records, not proof that this process is still live.

Execution commits a write-ahead claim when a process-local busy period starts. Success, failure, and user interruption release the claim; shutdown interruption and unclean process death preserve it. On startup, managed Node and fetch runtimes resume claimed top-level Sessions, append a durable continuation instruction, and count recovery attempts. Recovery is bounded per claimed execution but does not guarantee exactly-once provider requests or tool effects.

## One Step May Have Several Physical Attempts

Before each Step, the runner reloads Session History, resolves the selected agent and model, prepares instructions, and materializes tools. Most Steps make one Physical Attempt. Generic retry, continuation-state rejection, incomplete-stream continuation, or overflow-triggered compaction may make another attempt without promoting input again.

Each complete local tool call is durable before side effects begin. Local calls start eagerly and may run concurrently, but terminal outcome publication remains serialized. Every local and hosted call reaches durable success or failure before the Step publishes its single terminal ended or failed event.

Tool calls belong to their assistant message. A tool-call `id` is unique only within that Step, so durable tool events also carry `assistantMessageID`.

At drain start, orphan reconciliation fails tool calls still projected as streaming or running from an earlier process before further model work. It preserves the original assistant attribution and never directly replays ambiguous side effects.

After a local outcome, continuation reloads projected history and begins a new Step. The runner never delegates orchestration to an in-memory tool loop.

## Retry Is Narrow And Observable

Generic scheduled retry covers rate-limit and provider-internal failures, transport failures that are unsent or have unknown delivery, and provider output classified as an incomplete stream. The initial request plus at most four retries use jittered exponential backoff, increased when the provider supplies a longer retry delay.

Before durable output, generic retries retain the logical step number and assistant message ID and do not consume another agent-step allowance. An incomplete stream after durable output instead preserves the failed partial assistant, adds a synthetic continuation instruction, and continues with a new assistant message ID under the same retry budget. Provider continuation rejection permits one immediate full-context rebuild without a scheduled-retry event. `session.retry.scheduled` records generic backoff; later activity or a terminal execution event clears projected retry state.

A normalized content-filter finish fails the Step. Any partial streamed content remains visible.

## Instructions Are Value Deltas

Instruction sync persists content-addressed values and may freeze rendered chronological prose. `session.instructions.updated { delta, text? }` maps each changed source key to a SHA-256 content hash, with the literal `"removed"` for observed absence. Canonical JSON bodies live once in the machine-local `instruction_blob` store. The projected `instruction_state` row supplies current and epoch-initial values during normal boundary processing. The runner explicitly combines built-ins, ambient discovery, selected-agent skill guidance, references, MCP guidance, and API-managed instruction entries. There is no instruction registry.

Before each Physical Attempt that reaches model execution, the runner reads every source concurrently exactly once, hashes encoded values, and admits one delta atomically with its new blobs before input delivery. The initial delta must be complete; it carries no update text. An unavailable source blocks only that initial delta and otherwise silently retains the stored value. Request assembly renders the epoch baseline from stored values. Later changes render once at admission, freeze optional `text` in the durable event, and project that text as a chronological System message; clients display changed keys rather than privileged prose.

An instruction epoch spans completed compactions. `session.compaction.ended` moves the epoch start to its exact sequence, making current values initial, without reading sources or authoring an instruction event. Session movement retains state so destination changes become chronological updates; committed revert clears state so the next boundary establishes a fresh baseline. A fork copies messages only through its selected boundary but adopts the parent's newest instruction values as its baseline. Model selection affects request assembly but is not itself an instruction source.

## Compaction Rebuilds Active History

Before each Step, the runner estimates the complete model-visible request against the selected model's context window and reserved output headroom. When compaction is enabled, model limits are known, and enough older Session History is available, the runner may store a structured rolling summary plus bounded recent context instead of sending an over-budget request.

The full transcript remains durable. Active model history after the compaction boundary contains the summary and retained recent context; provider-native continuation state does not cross that boundary.

If automatic compaction is enabled and the provider reports context overflow before durable assistant output or tool execution, the runner may perform one overflow-triggered compaction and rebuild the same logical Step. A second overflow, any overflow after durable output, or an overflow when automatic compaction is disabled is terminal.

## Durable Events Are Session-Scoped

`sessions.log({ sessionID, after?, follow? })` verifies the Session and reads public durable Session events after an exclusive aggregate sequence. With `follow: true`, it subscribes before replay and emits one synchronization marker at the captured watermark before live durable events continue.

Live-only text, reasoning, tool-input, and compaction deltas are intentionally absent from replay. The instance-wide live event stream has different schemas and no replay guarantee.

There is no separate finite Session-history endpoint. Request/response consumers use authoritative Session projections such as messages, pending input, and context; replay consumers use the durable log.

## Recovery Boundaries Stay Explicit

An advisory wake is not itself crash recovery. Crash recovery is driven by a write-ahead execution claim that survives without a releasing terminal. Startup recovery resumes claimed top-level Sessions from durable projected history with bounded attempt accounting. It fails stale running tool projections before continuing, but it cannot prove whether an interrupted external operation already took effect and does not guarantee exactly-once provider or tool behavior.

Event replay ownership is separate from Session execution ownership. Local execution remains process-owned until clustering introduces an explicit placement and fencing protocol.
