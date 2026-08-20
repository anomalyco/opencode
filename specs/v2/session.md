# V2 Session Contract

Status: **Current semantic overview.** Protocol owns public operations, Schema owns public shapes and durable events, and Core owns execution and persistence behavior.

## Prompt Admission Precedes Execution

`Session.prompt(...)` publishes one durable `session.inbox.enqueued` fact whose projection inserts one `session_inbox` row before advisory execution begins. An inbox item remains outside model-visible Session History until delivery. The `session.inbox.delivered` projection consumes the row and inserts a visible user or synthetic message atomically; compaction and move control items are consumed without becoming transcript messages.

Reusing a Session ID adopts the existing Session. While a user or synthetic item remains pending, reusing its ID reconciles only when Session, item type, complete payload, metadata, and delivery match; conflicting reuse fails. After delivery, retry reconciliation for those message-producing items uses the projected message and does not require enqueue history or the original delivery mode. Compaction and move controls retain operation-specific conflict behavior.

`resume` controls scheduling, not durability:

- Omitted or `true` records the input, then schedules `SessionExecution.wake(sessionID)`.
- `false` records the input without scheduling execution.

Delivery is explicit:

- `steer` is the default. Steers deliver in enqueue order at the next Safe Step Boundary. Delivery stops before a compaction or move control item.
- `queue` remains pending while the Session can continue. At an idle boundary, steers still take priority; otherwise one queued item delivers, followed by any steers that arrived during delivery. The runner then reevaluates continuation before another queued item.

Promoting new user input resets the selected agent's step allowance. A batch of steers resets it once.

Manual compaction and Session movement use the same inbox as control items. Each request has its own inbox identity and delivery mode. A control item forms a delivery boundary so later steers do not cross it.

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

If the provider reports context overflow before durable assistant output or tool execution, the runner may perform one overflow-triggered compaction and rebuild the same logical Step. A second overflow or any overflow after durable output is terminal.

## Durable Events Are Session-Scoped

`sessions.log({ sessionID, after?, follow? })` verifies the Session and reads public durable Session events after an exclusive aggregate sequence. With `follow: true`, it subscribes before replay and emits one synchronization marker at the captured watermark before live durable events continue.

Live-only text, reasoning, tool-input, and compaction deltas are intentionally absent from replay. The instance-wide live event stream has different schemas and no replay guarantee.

There is no separate finite Session-history endpoint. Request/response consumers use authoritative Session projections such as messages, pending input, and context; replay consumers use the durable log.

## Recovery Boundaries Stay Explicit

An advisory wake is not itself crash recovery. Crash recovery is driven by a write-ahead execution claim that survives without a releasing terminal. Startup recovery resumes claimed top-level Sessions from durable projected history with bounded attempt accounting. It fails stale running tool projections before continuing, but it cannot prove whether an interrupted external operation already took effect and does not guarantee exactly-once provider or tool behavior.

Event replay ownership is separate from Session execution ownership. Local execution remains process-owned until clustering introduces an explicit placement and fencing protocol.
