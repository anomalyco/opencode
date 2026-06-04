# Event-Sourced Session Input Plan

## Status

Proposed redesign for the pre-launch V2 Session core. Do not merge the current
message-identity cutover until this plan is accepted or rejected.

## Problem

The current Session core correctly separates prompt admission from context-eligible
promotion, but it stores admitted pending prompts directly in `session_input`.
That row survives a local process restart, yet it cannot be reconstructed from
the synchronized Session event log or transferred by workspace replay.

The current hybrid model is:

| Concern                        | Current source of truth          |
| ------------------------------ | -------------------------------- |
| Accepted but unpromoted prompt | Direct `session_input` row       |
| Promoted prompt                | `session.next.prompted` event    |
| Visible timeline               | Projected `session_message` rows |
| Replay and workspace warp      | Synchronized `event` rows        |

This creates one exception to the event-sourced model: accepted pending input is
durable but not replayable.

## Decision

Make every accepted Session prompt a canonical synchronized event before it
enters the prompt-lifecycle materialization.

```text
event
  -> canonical Session facts

session_input
  -> rebuildable prompt-lifecycle materialization

session_message
  -> rebuildable context-eligible timeline projection
```

Keep execution coordination operational and advisory. Replaying state must never
call a provider, restart a tool, or infer that ambiguous remote work is safe to
repeat.

`session_input` remains useful on the command side: event append and lifecycle
materialization update commit in one transaction. It is rebuildable from events,
but it is not a passive eventually-consistent view.

## Domain Language

| Term                     | Meaning                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Prompt Admission**     | The durable fact that OpenCode accepted one prompt and its immutable delivery mode.                                  |
| **Prompt Promotion**     | The durable fact that an admitted prompt entered context-eligible timeline history at a safe provider-turn boundary. |
| **Pending Input**        | An admitted prompt that has not been promoted or canceled.                                                           |
| **Visible User Message** | The timeline projection created when one admitted prompt is promoted.                                                |
| **Advisory Wake**        | A process-local notification that eligible durable work may exist; it is not canonical state.                        |

## Identity Model

Use independent identities for resources and immutable facts:

| Identity    | Meaning                                                                                      | Generation                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `msg_*`     | One globally unique user-prompt lifecycle and its reserved eventual visible user-message row | Caller-supplied when optimistic rendering or exact retry is needed; otherwise Core generates it during admission |
| `evt_*`     | One immutable domain fact                                                                    | Core generates a fresh ID for each event append                                                                  |
| `event.seq` | Durable per-Session aggregate event order                                                    | Event store assigns it transactionally                                                                           |

Core-generated `msg_*` IDs use the existing sortable generator. Caller-supplied
IDs must satisfy the public `SessionMessage.ID` contract and remain globally
unique. Retry-capable clients should use the SDK's safe sortable-ID helper once
that surface is exposed rather than constructing IDs ad hoc. IDs do not define
timeline order. Timeline order comes from durable aggregate sequence.

For prompt lifecycles, do not derive `messageID` from `PromptAdmitted` or
`PromptPromoted` envelope IDs, and do not derive either envelope ID from
`messageID`. One prompt lifecycle has multiple immutable events.

This first slice does not require a broad identity rewrite for every timeline
creator. Non-prompt assistant, shell, compaction, synthetic, agent-switch, and
model-switch rows may continue deriving their `msg_*` resource IDs from creator
`evt_*` envelopes until a separate migration is justified.

```text
evt_101 -> PromptAdmitted  { messageID: msg_7 }
evt_102 -> PromptPromoted  { messageID: msg_7 }
```

## Minimal Event Vocabulary

### `session.next.prompt.admitted`

```ts
PromptAdmitted {
  sessionID
  timestamp
  messageID
  prompt
  delivery // "steer" | "queue"
}
```

Meaning: OpenCode accepted one immutable prompt intent. Projecting this event
inserts one pending `session_input` row.

### `session.next.prompt.promoted`

```ts
PromptPromoted {
  sessionID
  timestamp
  messageID
}
```

Meaning: one previously admitted prompt entered context-eligible history. Projecting
this event marks the input promoted and inserts one visible user
`session_message` row.

Do not duplicate `prompt` or `delivery` into `PromptPromoted`. The admitted fact
already owns those immutable values.

### Deferred: `session.next.prompt.canceled`

```ts
PromptCanceled {
  sessionID
  timestamp
  messageID
  reason?
}
```

Add this only when a concrete API or UI needs pending-input cancellation. It is
valid only before promotion.

## Canonical Lifecycle

```text
UI                     Core                            Session log                       session_input       session_message
 │                       │                                  │                                  │                    │
 ├─ prompt(id?: msg_7) ──▶                                  │                                  │                    │
 │                       │                                  │                                  │                    │
 │                       ├─ evt_101 PromptAdmitted(msg_7) ──▶                                  │                    │
 │                       │                                  │                                  │                    │
 │                       │                                  ├─ insert msg_7 pending @ seq 12 ──▶                    │
 │                       │                                  │                                  │                    │
 │                       ├─ evt_102 PromptPromoted(msg_7) ──▶                                  │                    │
 │                       │                                  │                                  │                    │
 │                       │                                  ├─ set promoted_seq = 19 ──────────▶                    │
 │                       │                                  │                                  │                    │
 │                       │                                  ├─ insert msg_7 visible @ seq 19 ───────────────────────▶
 │                       │                                  │                                  │                    │
```

Prompt lifecycle state:

```text
  PromptAdmitted ╭─────────╮ PromptPromoted ╭─────────╮ remains transcript history
●───────────────▶│ Pending ├───────────────▶│ Visible ├───────────────────────────▶◎
                 ╰──┬──────╯                ╰─────────╯                            ▲
                    │ PromptCanceled (later)                                       │
                    ╰──────────────────────────╮                                   │
                                               │        remains audit history      │
                                               ▼   ╭───────────────────────────────╯
                                           ╭───────┴──╮
                                           │ Canceled │
                                           ╰──────────╯
```

## Projected Table Shape

### `session_input`

```text
id             TEXT PRIMARY KEY   // msg_*
session_id     TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE
admitted_seq   INTEGER NOT NULL   // non-negative PromptAdmitted aggregate seq
promoted_seq   INTEGER            // PromptPromoted aggregate seq, nullable
prompt         JSON NOT NULL
delivery       TEXT NOT NULL      // steer | queue
time_created   INTEGER NOT NULL   // admitted timestamp

UNIQUE(session_id, admitted_seq)
UNIQUE(session_id, promoted_seq) WHERE promoted_seq IS NOT NULL
INDEX(session_id, promoted_seq, delivery, admitted_seq)
```

`session_input` becomes a rebuildable lifecycle materialization. Admission order comes from
`PromptAdmitted` aggregate order rather than an independently authoritative
autoincrement inbox counter. Pending reads select rows without a terminal
transition. Command handling may use this materialization transactionally to
reserve identities and enforce legal state transitions while appending canonical
events.

`session_input.id` reserves one prompt lifecycle ID, but SQLite cannot enforce
global `msg_*` uniqueness across `session_input` and `session_message` with one
table constraint. Inside synchronized append transactions:

- `PromptAdmitted` rejects a `messageID` already present in `session_message`.
- Prompt lifecycle rows remain retained after promotion so reservation remains
  durable.
- Any non-prompt creator that derives a `msg_*` row from its `evt_*` envelope
  rejects an ID reserved by `session_input.id`.
- `PromptPromoted` strictly inserts its user transcript row; it never overwrites
  another transcript resource through an upsert.

Do not add a separate resource-reservation table in the first slice unless these
guarded projections become difficult to maintain.

### `session_message`

For a promoted user prompt:

```text
id             msg_7
session_id     session ID
seq            PromptPromoted aggregate seq
type           user
data           projected visible user message
```

For that user prompt:

```text
session_input.promoted_seq === session_message.seq
```

For assistant, shell, compaction, and other timeline rows, `session_message.seq`
continues to mean the event position where the visible row first appeared. Later
events update the row without moving it.

`PromptAdmitted.timestamp` is Core-assigned acceptance time.
`PromptPromoted.timestamp` is Core-assigned context-promotion time. The projected
user message retains admission time as its authored `time.created`, while
`session_message.seq` records later transcript insertion order.

## Command Path

```text
sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })
  -> use caller-supplied msg_* ID when present
  -> otherwise generate one sortable msg_* ID in Core
  -> append PromptAdmitted exactly once
  -> projector inserts pending session_input row
  -> schedule advisory wake unless resume is false
  -> return admission receipt
```

Supplying an ID is optional. It is useful when the caller needs optimistic UI,
stable exact retries, or external correlation. Simple callers may omit it and use
the Core-generated ID returned in the admission receipt.

Core-generated IDs are convenient but cannot deduplicate a retry after the
admission response is lost: the caller never learned the generated ID. Retry-
capable HTTP and SDK clients should generate and persist a sortable `msg_*` ID
before submission. Resubmitting an omitted-ID request after an ambiguous response
intentionally creates a new prompt lifecycle.

Promotion path:

```text
runner reaches safe provider-turn boundary
  -> query eligible pending session_input rows
  -> append PromptPromoted(messageID) exactly once
  -> projector marks session_input row promoted
  -> projector inserts visible session_message row
```

## Exact Retry Contract

| Request                                              | Result                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Same supplied `msg_*`, Session, prompt, and delivery | Return the original admission receipt; optionally schedule a fresh wake  |
| Same supplied `msg_*`, different Session             | Reject conflict                                                          |
| Same supplied `msg_*`, different prompt              | Reject conflict                                                          |
| Same supplied `msg_*`, different delivery            | Reject conflict                                                          |
| Omitted ID                                           | Core creates a new prompt lifecycle and returns its generated `msg_*` ID |
| Same supplied `msg_*` after promotion                | Return the original receipt; never create a second visible message       |

`resume` remains command-delivery metadata, not accepted-intent identity. An
exact retry may request another advisory wake without changing canonical facts.

Concurrent exact retries require append-once semantics keyed by `messageID`. Do
not implement this as `check projection -> append random event`, which races.

## Command-Side Lifecycle Invariants

Keep `session_input` as a rebuildable command-side lifecycle materialization
updated inside the same transaction as canonical event append:

| Event or command                      | Preconditions                                                           | Transactional result                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `PromptAdmitted`                      | No lifecycle exists for `messageID`                                     | Append admission event and insert immutable admitted lifecycle       |
| Equivalent exact retry                | Existing admission has the same Session, canonical prompt, and delivery | Return existing receipt; append no event                             |
| Conflicting exact retry               | Existing lifecycle differs                                              | Reject conflict                                                      |
| `PromptPromoted`                      | Matching lifecycle exists and is pending                                | Append promotion event, mark promoted, and insert one transcript row |
| Equivalent duplicate promotion replay | Same stored immutable event fact                                        | No-op                                                                |
| Second distinct promotion             | Lifecycle is already promoted                                           | Reject conflict                                                      |
| Future `PromptCanceled`               | Matching lifecycle exists and is pending                                | Append cancellation event and mark canceled                          |
| Promotion after cancellation          | Lifecycle is canceled                                                   | Reject conflict                                                      |

Admission reserves `messageID` transactionally. Promotion conditionally
transitions `pending -> promoted`. This materialization is rebuildable from
canonical events, but canonical append and state transition remain atomic.

### Atomic Idempotent Admission

This is **command idempotency**, not event replay deduplication. Follow the
Stripe `Idempotency-Key`, AWS `ClientToken`, and Effect Cluster SQL mailbox
pattern: persist one stable caller-intent key, compare canonical request
semantics, store the durable receipt, and return that receipt to exact retries.

Use the existing lifecycle row rather than adding a generic event-deduplication
column:

```text
session_input.id
  -> globally unique msg_* prompt idempotency key
  -> durable lifecycle materialization
  -> stored admission receipt
```

Admission runs in one immediate SQLite transaction:

| Existing lifecycle                                             | Result                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| No row for `msg_7`                                             | Generate fresh `evt_*`, append `PromptAdmitted(msg_7)`, project lifecycle row, commit |
| Equivalent row for `msg_7`                                     | Return current stored lifecycle receipt; append nothing                               |
| Same `msg_7`, different Session, canonical prompt, or delivery | Reject `PromptConflictError`                                                          |

Promotion uses the same lifecycle materialization as a compare-and-set
gate:

```text
pending
  -> append fresh PromptPromoted(msg_7) evt_*
  -> set promoted_seq
  -> insert visible session_message

already promoted
  -> append nothing
  -> return current stored lifecycle receipt
```

The event append and lifecycle transition commit atomically. Do not use
`EventV2.ID.fromExternal(...)`, reversible `msg_* -> evt_*` derivation, or a
payload hash by itself as prompt idempotency. Two identical prompt payloads can be
intentional distinct commands.

Event replay deduplication remains separate:

```text
evt_*
  -> immutable event identity

(aggregate_id, seq)
  -> immutable log position
```

Effect Cluster provides useful local prior art in
`effect/unstable/cluster/SqlMessageStorage`: stable `message_id`, fresh request
envelope ID, conflict-safe SQL insertion, and stored replies. Adapt that pattern;
do not adopt the Cluster mailbox runtime as the Session source of truth.

The synchronized EventV2 append transaction is the linearization boundary.
Command-side lifecycle reads before append are advisory fast paths only. The
`PromptAdmitted` and `PromptPromoted` reducers run inside the EventV2-owned
`BEGIN IMMEDIATE` append transaction before the canonical event row commits:

- `PromptAdmitted` requires that no lifecycle or transcript resource already
  reserves `messageID`, then inserts the immutable lifecycle row with
  `admitted_seq = event.seq`.
- `PromptPromoted` requires one matching pending lifecycle row, updates it with
  `promoted_seq = event.seq`, asserts exactly one changed row, then strictly
  inserts the visible transcript row.
- Any failed gate aborts aggregate sequence advancement and canonical event
  insertion.

If two contenders both miss the fast path, one append commits. The losing append
rolls back at the reducer gate, reloads the lifecycle row, and returns it only
when canonical Session, prompt, and delivery semantics are equivalent.

Do not wrap EventV2 publication in an outer SQL transaction unless tail wakeups,
listeners, and synchronization delivery are deferred until the outermost commit.

## Scheduling Policy

The first replayable-input slice preserves the existing lane semantics:

| State                    | Pending input                | Result                                                                             |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| Active activity          | `steer`                      | Promote at the next safe provider-turn boundary; coalesce steers in admitted order |
| Active activity          | `queue`                      | Keep pending for a future activity                                                 |
| Idle Session             | one or more `steer`          | Promote pending steers before opening queued work                                  |
| Idle Session             | `queue` and no pending steer | Promote exactly one oldest queue row to open the next activity                     |
| Queue row opens activity | pending steers exist         | Promote queue opener, then coalesce eligible steers into that activity             |

This is not global FIFO. Admission order and context-eligible order intentionally
differ when steers join active work ahead of queued future activities.

Make the linearization boundary explicit:

- Queue FIFO means ascending `PromptAdmitted` aggregate sequence among queued
  inputs.
- At each safe provider-turn boundary, capture one aggregate-sequence cutoff.
- Promote eligible steers through that cutoff in admitted-sequence order.
- A steer admitted after the cutoff waits for the next safe provider-turn
  boundary.
- When idle, pending steers through the captured cutoff open the next activity
  ahead of older queued inputs. If no steer is eligible, one oldest queue row
  opens the next activity.
- When a queue row opens an activity, coalesce steers only through the cutoff
  captured for that boundary.

## Replay; Workspace Transfer Out Of Scope

```text
Source                        Session log                        Target                      Target projections
   │                               │                                │                                 │
   ├─ PromptAdmitted(msg_queue7) ──▶                                │                                 │
   │                               │                                │                                 │
   │                               ├─ replay evt_* through cursor ──▶                                 │
   │                               │                                │                                 │
   │                               │                                ├─ rebuild pending msg_queue7 ────▶
   │                               │                                │                                 │
   │                               │                                │                                 │
   │                               │                                │  replay never wakes execution   │
   │                               │                                │                                 │
   ◀─ pending queue preserved ──────────────────────────────────────┤                                 │
   │                               │                                │                                 │
```

Replay must rebuild projections without triggering execution. A pending prompt
may arrive in the target workspace and remain pending until a deliberately
authorized execution command schedules progress.

Fresh-target replay occurs in a staged empty target that does not accept Session
commands until activation. This proves reconstructability only.

Experimental workspace sync and warp are unreleased and out of scope for this
slice. They are hard-fenced during cutover; discard or recreate stale remote beta
workspaces. Design online transfer separately if it becomes a real requirement.

Distinguish two reconstruction guarantees:

```text
fresh-target reconstruction
  -> replay canonical events into an empty target
  -> rebuild lifecycle and timeline materializations while inserting events

same-store projection repair
  -> rebuild materializations while canonical events already exist locally
  -> requires an explicit reproject path or projector checkpoints
```

The first slice guarantees fresh-target reconstruction. Decide separately whether
same-store projection repair is required before launch.

## Crash Workflow Table

| Crash window                                                           | Required behavior                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Before `PromptAdmitted` append                                         | No accepted prompt exists. A caller may retry normally.                                                          |
| After `PromptAdmitted` append, before HTTP response                    | Exact retry with the same supplied `msg_*` returns the original receipt.                                         |
| After `PromptAdmitted` append, before advisory wake                    | Input remains pending and replayable. A later deliberately authorized execution command may schedule progress.   |
| During `PromptPromoted` transaction                                    | Either input remains pending, or promotion and visible timeline insertion both commit. Never half-promoted.      |
| After promotion, before provider call                                  | Prompt remains visible. Automatic provider recovery is still a separate policy.                                  |
| After provider call leaves the process, before first stream event      | Provider outcome is ambiguous. Do not automatically retry merely because replay or wake occurs.                  |
| After local `Tool.Called`, before side effect settles                  | Tool outcome is ambiguous. Preserve conservative interruption settlement; do not replay side effects by default. |
| After local side effect, before `Tool.Success` or `Tool.Failed` append | Side effect may have committed without durable settlement. Do not repeat it automatically.                       |
| After provider-hosted tool execution, before durable observation       | Remote side effect may have occurred without local durable evidence. Treat continuation as ambiguous.            |
| During partial tool-input streaming                                    | Live fragments may be incomplete. Reconnect converges from durable full-value boundaries only.                   |

## Provider Recovery Boundary

```text
UI                     Core                    Session log                          Runner                          Provider
 │                       │                          │                                  │                                │
 ├─ prompt(id?: msg_7) ──▶                          │                                  │                                │
 │                       │                          │                                  │                                │
 │                       ├─ PromptAdmitted(msg_7) ──▶                                  │                                │
 │                       │                          │                                  │                                │
 │                       ├─ advisory wake ─────────────────────────────────────────────▶                                │
 │                       │                          │                                  │                                │
 │                       │                          ◀─ PromptPromoted(msg_7) ──────────┤                                │
 │                       │                          │                                  │                                │
 │                       │                          │                                  ├─ llm.stream(request) ──────────▶
 │                       │                          │                                  │                                │
 │                       │                          │                                  │                                │
 │                       │                          │                                  │  crash here can be ambiguous   │
 │                       │                          │                                  │                                │
 │                       │                          │                                  ◀─ stream events ────────────────┤
 │                       │                          │                                  │                                │
 │                       │                          ◀─ durable assistant checkpoints ──┤                                │
 │                       │                          │                                  │                                │
```

Replayable admission does not solve ambiguous provider recovery. Keep these as a
separate future design slice:

```text
durable activity identity
queue-opener reservation and steer assignment
provider-attempt preparation versus dispatch ambiguity
required post-tool continuation
explicit retry and abandon decisions
startup discovery
clustered execution ownership and stale-runtime fencing
```

Do not add `WakeRequested`, `SessionBusy`, `SessionIdle`, or
`ProviderDispatched` events merely to make the log look complete. Add lifecycle
facts only when the domain semantics and recovery consumer are concrete.

An advisory wake is only a latency optimization after durable admission. Replay
never emits one. A newly submitted prompt with normal resume behavior is explicit
user authorization for a fresh continuation from durable history, even when a
prior provider outcome is ambiguous. The continuation does not replay a missing
provider response or automatically repeat old tool side effects.

A replay-triggered or background wake without newly admitted user intent is not
recovery authorization. Automatic startup scanning remains deferred. Decide
separately whether bare `sessions.resume(...)`, without a new prompt, authorizes
continuation after ambiguous prior provider work.

## Workflow Scenarios

| Workflow                                | Canonical events                                                            | Pending projection                             | Visible timeline                      |
| --------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Admit-only prompt with `resume: false`  | `PromptAdmitted(msg_1)`                                                     | `msg_1` pending                                | unchanged                             |
| Active stream receives steer            | `PromptAdmitted(msg_2)`, then `PromptPromoted(msg_2)` at next safe boundary | `msg_2` promoted                               | append `msg_2` when promoted          |
| Active stream receives queue            | `PromptAdmitted(msg_3)`                                                     | `msg_3` pending                                | unchanged until future activity opens |
| Queue opens future activity             | `PromptPromoted(msg_3)`                                                     | `msg_3` promoted                               | append `msg_3`                        |
| Workspace replay before queue promotion | replay `PromptAdmitted(msg_3)`                                              | rebuild `msg_3` pending on target              | unchanged                             |
| Exact retry before promotion            | no new event                                                                | unchanged                                      | unchanged                             |
| Exact retry after promotion             | no new event                                                                | unchanged                                      | unchanged                             |
| Future pending cancellation             | `PromptCanceled(msg_3)`                                                     | `msg_3` canceled or omitted from pending reads | unchanged                             |

## Replay Hardening Required Alongside This Slice

Treat transport delivery as at-least-once:

- `evt_*` globally identifies one immutable canonical-encoded fact.
- `(aggregateID, seq)` uniquely identifies one aggregate position and must have
  a relational uniqueness constraint.
- Durable projection append and replay accept an already-stored aggregate
  position as a no-op only when event ID, aggregate, sequence, versioned type,
  and canonical encoded payload are equivalent.
- Replay fails loudly when the same aggregate position carries divergent
  content, or when the same event ID is reused at another aggregate position.
- Connected reducers must deduplicate every durable event by event ID before
  applying it, with bounded retention tied to durable cursor progress or snapshot
  replacement. Reconcile transcript resources by `msg_*` ID as a second layer.
- Ephemeral text, reasoning, and tool-input deltas must remain explicitly
  reconnect-repairable from durable full-value boundaries.

Strict stale replay algorithm inside one EventV2 append transaction:

1. Look up the stored row by `(aggregate_id, seq)`.
2. Look up the stored row by `event.id`.
3. If the aggregate position exists, accept a no-op only when both lookups
   identify the same stored row and `id`, `aggregate_id`, `seq`, versioned `type`,
   and canonical encoded `data` are structurally equivalent.
4. If `event.id` exists at another aggregate position, reject.
5. If the aggregate position is absent, require `seq === latest + 1`, run
   projectors, append the event row, and advance `event_sequence`.
6. Never invoke projectors or publish live notifications for an equivalent stale
   no-op.

Enforce relationally:

```sql
CREATE UNIQUE INDEX event_aggregate_seq_unique
ON event (aggregate_id, seq);
```

## Coordinated Experimental Reset

V2 Session events, inbox rows, and projected timeline rows remain experimental
and unshipped. However, `event` is one shared synchronized log. A global deletion
removes retained Session creation roots, V1 replay history, V2 history, aggregate
cursors, and replay-owner claims. It cannot be described merely as a projection
reset.

Use one coordinated experimental sync-epoch reset:

```text
reset synchronized beta epoch state
  event
  event_sequence
  session_input
  session_message

preserve local canonical V1 rows
  session
  message
  part
```

Hard-fence experimental workspace sync and discard or recreate every remote beta
workspace before replay resumes. Without that operational gate, a stale remote
workspace can replay pre-cutover history back into the emptied local log.

Retained pre-cutover Sessions remain locally readable from canonical V1 rows but
are not self-contained replay sources. Recording later suffix events does not
restore the missing synchronized Session root. Sessions created after the reset
can become replayable normally.

The shared table currently stores Session-scoped synchronized registrations, but
the cutover must audit persisted rows before reset rather than assume every future
aggregate family is disposable.

Rejected for this first slice:

| Alternative                                   | Why defer it                                                 |
| --------------------------------------------- | ------------------------------------------------------------ |
| Selectively reset affected Session aggregates | Retained Sessions still need truthful replay baselines.      |
| Backfill synchronized Session baselines       | Useful only if retained-Session portability is required now. |
| Preserve compatible prefixes                  | Highest compatibility complexity for unreleased beta state.  |

Schema changes:

1. Rebuild `session_input` through a replacement table because SQLite cannot
   replace the old autoincrement primary key in place. No inbox-row copy is
   required if the approved beta reset remains the cutover strategy.
2. Replace `session_input.seq` with non-negative aggregate-derived
   `admitted_seq` and preserve the Session foreign key.
3. Keep nullable `promoted_seq` sourced from `PromptPromoted` aggregate order.
4. Introduce `PromptAdmitted` and `PromptPromoted` synchronized event schemas.
5. Remove direct authoritative inbox insertion.
6. Remove prompt-lifecycle identity derivation between `evt_*` and `msg_*`.
7. Keep independent sortable `SessionMessage.ID.create()` and fresh
   `EventV2.ID.create()` helpers.
8. Regenerate HTTP and SDK schemas.

Do not enable mixed-version synchronized replay across the epoch boundary.

## Implementation Slices

### Slice 1: Canonical Prompt Lifecycle And Storage Safety

- Add independent `msg_*` prompt-lifecycle identity without event-ID conversion;
  leave non-prompt creator-resource derivation unchanged in this slice.
- Add `PromptAdmitted` and `PromptPromoted` schemas.
- Make `session_input` a rebuildable lifecycle materialization ordered by
  admission event sequence and updated transactionally with canonical appends.
- Preserve `steer`, `queue`, `resume`, and exact-retry behavior.
- Preserve command-idempotent admission keyed by globally unique
  `session_input.id = messageID`, with canonical payload comparison and stored
  lifecycle receipts.
- Add atomic pending-to-promoted compare-and-set semantics so repeated or
  concurrent wakes append one promotion fact.
- Return an explicit admission receipt rather than pretending a pending input is
  already a visible `SessionMessage.User` row.
- Expose a minimal `sessions.inputs(...)` lifecycle read surface so reconnecting
  clients can render accepted pending work without inferring it from transcript
  shape.
- Update TUI and HTTP consumers to distinguish admission from promotion.
- Add a relational uniqueness constraint for `(aggregate_id, seq)`.
- Reject divergent stale replay and event-ID reuse at another aggregate position.
- Make connected consumers deduplicate every durable event before reducer
  application.
- Keep experimental workspace sync and warp out of scope. Expose replayable
  storage reconstruction without claiming online Session handoff support.
- Update or remove the temporary V1 prompt dual-write bridge in
  `packages/opencode/src/session/prompt.ts`. If retained, emit an admitted fact
  followed immediately by a promoted fact for the same `msg_*`, because the V1
  user message is already visible when the bridge runs.
- Remove `SessionInput.reconcileProjected()` after the reset unless mixed-history
  support is intentionally retained. If retained, specify how legacy visible
  prompt events synthesize admission and promotion sequences.

Minimum receipt shape:

```ts
type PromptAdmissionReceipt = {
  id: SessionMessage.ID
  sessionID: SessionSchema.ID
  admittedSeq: EventV2.Cursor
  prompt: Prompt
  delivery: "steer" | "queue"
  timeCreated: DateTime.Utc
  state: "pending" | "promoted"
  promotedSeq?: EventV2.Cursor
}
```

The receipt is a current lifecycle snapshot. Initial admission normally returns
`pending`; an exact retry after promotion may return `promoted` with the original
admission fields and populated `promotedSeq`.

### Slice 2: Projection Repair Decision

- Decide whether launch requires same-store reprojection while canonical events
  remain in place.
- If required, add an explicit reproject path or per-projector checkpoint model.

### Slice 3: Pending-Input Read Model

- Enrich the minimal `sessions.inputs(...)` surface into a combined timeline
  snapshot if clients need one fetch for messages and pending lifecycle rows.
- Reconcile optimistic client state by stable `msg_*` identity.

### Deferred Slice: Activity Recovery And Placement

- Design durable activity identity, provider ambiguity, retry and abandon
  decisions, interruption, startup scanning, and clustered
  execution ownership together.

## TDD Contract

These requirement IDs are the implementation checklist. Each invariant maps to
one or more future tests. Implement the first slice by turning the rows red, then
green, in dependency order.

### Prompt Lifecycle

| ID       | Required invariant                                                                                                                                                                   | Future test                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `REQ-01` | Every accepted prompt appends exactly one canonical `PromptAdmitted` event and one lifecycle row.                                                                                    | Submit one prompt and assert one event plus one `session_input` row with matching `admitted_seq`.        |
| `REQ-02` | A supplied `msg_*` controls retry identity. An omitted ID causes Core to generate a new sortable `msg_*`; resubmitting without an ID creates another lifecycle.                      | Submit supplied-ID, omitted-ID, and omitted-ID-resubmission variants.                                    |
| `REQ-03` | Same `msg_*`, Session, canonical prompt, and delivery is idempotent, including concurrent retries.                                                                                   | Submit two concurrent equivalent requests and assert one admission event plus equal lifecycle receipts.  |
| `REQ-04` | Reusing one `msg_*` with a different Session, canonical prompt, or delivery rejects with `PromptConflictError`.                                                                      | Retry each conflicting variant independently.                                                            |
| `REQ-05` | `resume` is operational metadata, not admitted intent. An exact retry may schedule another wake without appending another admission.                                                 | Retry an admitted prompt with `resume: true`; assert one admission event and a fresh advisory wake.      |
| `REQ-06` | Promotion is an atomic `pending -> promoted` compare-and-set. It appends at most one `PromptPromoted`, writes one `promoted_seq`, and strictly inserts one visible user-message row. | Race repeated wakes and concurrent promotion attempts; assert one promotion fact and one transcript row. |
| `REQ-07` | Invalid lifecycle histories fail: promotion without admission, distinct second admission, distinct second promotion, and future promotion after cancellation.                        | Replay each malformed event sequence and assert rejection.                                               |

### Resource Identity And Ordering

| ID       | Required invariant                                                                                                                                               | Future test                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-08` | `msg_*` is globally reserved across retained prompt lifecycle and transcript rows.                                                                               | Reject admission when `session_message.id` already owns the ID; reject non-prompt creator projection when `session_input.id` reserves it. |
| `REQ-09` | Prompt lifecycle `msg_*` identity is explicit event data and independent from fresh prompt `evt_*` envelopes.                                                    | Append admitted and promoted events for one `msg_*`; assert two distinct `evt_*` IDs and one stable message ID.                           |
| `REQ-10` | Admission order comes from `PromptAdmitted.seq`; visible timeline order comes from `PromptPromoted.seq`; `session_message.seq` never changes after row creation. | Admit older queue then newer steer, promote steer first, update later transcript content, and assert both sequence spaces.                |
| `REQ-11` | Steer batching has a deterministic cutoff. Steers through the captured aggregate sequence promote in admitted order; later steers wait for the next boundary.    | Admit steers before and after a captured boundary and assert batch membership and order.                                                  |

### Event Store And Replay

| ID       | Required invariant                                                                                                                                 | Future test                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-12` | `event.id` globally identifies one immutable fact and `(aggregate_id, seq)` uniquely identifies one immutable aggregate position.                  | Assert relational rejection for duplicate position and event-ID reuse at another position.                                            |
| `REQ-13` | Stale replay is a no-op only when stored and incoming event ID, aggregate, sequence, versioned type, and canonical encoded payload are equivalent. | Replay an exact stale prefix followed by a new suffix; validate prefix and apply suffix only.                                         |
| `REQ-14` | Divergent stale replay fails loudly before projector execution or live notification.                                                               | Replay changed ID, type, aggregate, position, and payload variants; assert rejection and unchanged projections.                       |
| `REQ-15` | Connected reducers treat durable delivery as at-least-once and apply each durable `evt_*` once.                                                    | Deliver every durable event twice and assert one reducer application, including tool progress and settlement.                         |
| `REQ-16` | Fresh-target replay rebuilds pending prompt lifecycles without execution or command acceptance before target activation.                           | Replay an admitted queue into a staged empty target; assert pending state, zero provider calls, and rejected pre-activation commands. |

### Recovery And Cutover

| ID        | Required invariant                                                                                                                                           | Future test                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `REQ-17`  | Replay reconstructs state but never schedules execution.                                                                                                     | Replay admitted and promoted histories and assert zero advisory wakes and provider calls.                                            |
| `REQ-18`  | Ambiguous provider or tool work never auto-retries from replay or an ordinary background wake.                                                               | Reconstruct unresolved provider and tool states, wake them without new user intent, and assert zero repeated side effects.           |
| `REQ-18A` | A newly submitted prompt authorizes one fresh continuation from durable history even when a prior provider outcome is ambiguous.                             | Crash after ambiguous provider dispatch, submit a new prompt, and assert one fresh provider turn without replaying old side effects. |
| `REQ-19`  | Experimental workspace sync remains disabled during cutover.                                                                                                 | Attempt stale remote beta replay while disabled and assert rejection.                                                                |
| `REQ-20`  | Coordinated cutover preserves local canonical V1 `session`, `message`, and `part` rows while clearing approved beta state.                                   | Run the migration and verify preserved local V1 rows plus cleared beta state.                                                        |
| `REQ-21`  | Retained pre-cutover Sessions remain locally readable but are not self-contained replay sources; new suffix events do not repair their missing Session root. | Append post-cutover suffix events to a retained Session and assert fresh-target replay rejection.                                    |
| `REQ-22`  | The V1 compatibility bridge cannot leave V2 half-promoted.                                                                                                   | Remove the bridge, or fault-inject an atomic admitted-plus-promoted bridge operation and assert no stale pending row.                |

### Public Read Model

| ID       | Required invariant                                                                                                                             | Future test                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `REQ-23` | `sessions.prompt(...)` returns an explicit lifecycle receipt rather than pretending admission already created a visible `SessionMessage.User`. | Admit one queued prompt; assert pending receipt and unchanged timeline.                          |
| `REQ-24` | `sessions.inputs(...)` exposes accepted pending lifecycle rows for reconnecting clients.                                                       | Admit queue and steer inputs, reconnect through the read API, and assert explicit pending state. |

### Deferred Contract

Do not make these tests green accidentally inside the first slice. They belong to
the later activity-recovery and placement design:

| ID         | Deferred requirement                                                                                                           | Future test                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `DEFER-01` | Decide whether bare `sessions.resume(...)`, without a new prompt, authorizes continuation after ambiguous prior provider work. | Resume an ambiguous activity without new user intent and assert the chosen policy.                                         |
| `DEFER-02` | Add same-store reprojection only if launch requires it.                                                                        | Delete lifecycle and timeline materializations while preserving canonical events, then rebuild without re-appending facts. |

## Open Questions

1. Does bare `sessions.resume(...)`, without a new prompt, authorize continuation
   after an ambiguous prior provider attempt? Recommendation: decide explicitly
   before startup scanning or cross-runtime wakes ship.
2. Can the temporary V1 prompt dual-write bridge be removed during cutover?
   Recommendation: remove it if possible. If retained, design one atomic
   admitted-plus-promoted bridge operation before implementation.

Resolved proposal decisions:

- Use prompt-specific `prompt.admitted` and `prompt.promoted` event names until a
  concrete non-prompt scheduled input exists.
- Keep `PromptPromoted` lean and enrich read-model APIs instead of duplicating
  immutable admitted content.
- Defer `PromptCanceled` until a UI or API requires pending cancellation.
- Preserve the current idle policy: eligible steers cut ahead of older queued
  future activities.
- Keep experimental workspace sync and warp out of the first slice.

## Supersedes On Acceptance

If this design is accepted, reconcile the surrounding normative documents:

- Update `specs/v2/session.md` to describe canonical `PromptAdmitted` and
  `PromptPromoted` facts and operational-only wakes.
- Update `specs/v2/session-inbox-ordering.md` to describe `session_input` as a
  rebuildable lifecycle materialization and `session_message` as a rebuildable
  context-eligible timeline projection.
- Append a new `specs/v2/schema-changelog.md` entry superseding reversible
  `evt_* <-> msg_*` derivation with explicit independent event and message IDs.

## Resulting Invariants

- Every accepted prompt has exactly one canonical `PromptAdmitted` event.
- Every visible user message has exactly one prior admission and at most one
  promotion.
- Pending prompts are replayable without becoming context-eligible.
- Reconstructable pending work is not automatically executable after replay;
  ambiguous prior activity requires an explicit recovery policy.
- Replay rebuilds state but never schedules execution.
- Callers may supply globally unique `msg_*` IDs for optimistic UI or exact
  retry; otherwise Core generates sortable IDs.
- Prompt lifecycle event envelopes always use fresh `evt_*` IDs independent of
  message IDs. Non-prompt timeline creator derivation remains unchanged in the
  first slice.
- Aggregate `seq`, not resource ID or timestamp, determines durable ordering.
- `session_message.seq` remains immutable creator-event timeline order.
- Wakes remain advisory and may coalesce.
- Replay ownership remains distinct from clustered execution ownership.
