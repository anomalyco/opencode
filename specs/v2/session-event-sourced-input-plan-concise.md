# Event-Sourced Session Inputs

Detailed plan: [`session-event-sourced-input-plan.md`](./session-event-sourced-input-plan.md)

## Model

```text
event
  -> canonical Session facts

session_input
  -> rebuildable prompt lifecycle and idempotency receipt

session_message
  -> rebuildable context-eligible timeline
```

```text
UI                     Core                    Session log                session_input       session_message
 │                       │                          │                           │                    │
 ├─ prompt(id?: msg_7) ──▶                          │                           │                    │
 │                       ├─ PromptAdmitted(msg_7) ──▶                           │                    │
 │                       │                          ├─ pending @ admitted_seq ──▶                    │
 ◀─ admission receipt ───┤                          │                           │                    │
 │                       ├─ PromptPromoted(msg_7) ──▶                           │                    │
 │                       │                          ├─ set promoted_seq ────────▶                    │
 │                       │                          ├─ visible msg_7 @ promoted_seq ─────────────────▶
```

## Identities

| Identity    | Meaning                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `msg_*`     | One prompt lifecycle and eventual user-message row. Caller-supplied ID is optional; otherwise Core generates one. |
| `evt_*`     | One immutable fact. Core generates a fresh ID per event.                                                          |
| `event.seq` | Canonical per-Session order. IDs and timestamps do not order the timeline.                                        |

```ts
PromptAdmitted { sessionID, timestamp, messageID, prompt, delivery }
PromptPromoted { sessionID, timestamp, messageID }
```

## Prompt API

```ts
sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })
```

`session_input.id = msg_*` is the durable command-idempotency key and stored
lifecycle receipt. Admission and event append commit in one immediate SQLite
transaction.

The EventV2 append transaction is the authoritative gate. Reads before append
are fast paths only; reducers re-check lifecycle invariants inside the append
transaction and abort the canonical event on conflict.

Because `session_input` and `session_message` are separate tables, admission
also rejects a `msg_*` already used by a transcript row. Non-prompt creator
projection rejects IDs reserved by retained prompt lifecycle rows.

| Request                                              | Result                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First request with `msg_7`                           | Append one `PromptAdmitted(msg_7)` and return receipt.                                       |
| Same `msg_7`, same Session, prompt, and delivery     | Return stored receipt; append nothing. Concurrent retries behave the same way.               |
| Same `msg_7`, different Session, prompt, or delivery | Reject conflict.                                                                             |
| Omitted ID                                           | Core generates a new sortable `msg_*`. Resubmission without an ID creates another lifecycle. |

`resume` may schedule another advisory wake. It never changes accepted intent.

## Scheduling

| State  | Input           | Result                                           |
| ------ | --------------- | ------------------------------------------------ |
| Active | `steer`         | Promote at the next safe provider-turn boundary. |
| Active | `queue`         | Keep pending for a future activity.              |
| Idle   | eligible steers | Promote steers ahead of queued work.             |
| Idle   | queue only      | Promote one oldest queue row.                    |

At each boundary, capture an aggregate-sequence cutoff. Promote steers through
that cutoff in admission order. Later steers wait for the next boundary.

## Safety Boundary

| Situation                     | Rule                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| Replay                        | Rebuild state only. Never execute work.                             |
| Duplicate event delivery      | Deduplicate by `evt_*`; validate `(aggregate_id, seq)` equality.    |
| Crash after provider dispatch | Outcome is ambiguous. Ordinary wake must not auto-retry.            |
| Crash after tool side effect  | Outcome is ambiguous. Do not repeat side effects automatically.     |
| Workspace sync and warp       | Keep the unreleased experimental path disabled during this cutover. |

A newly submitted prompt with normal resume behavior is explicit user
authorization for a fresh continuation from durable history. It does not replay
the missing provider response or automatically repeat old tool side effects.

Replay treats delivery as at-least-once. A stale `(aggregate_id, seq)` is a
no-op only when the stored event has the same event ID, versioned type, and
canonical encoded payload. Reusing an event ID at another position or sending
divergent content at an existing position fails loudly. Enforce:

```text
UNIQUE(event.aggregate_id, event.seq)
```

## Storage

```text
session_input
  id             TEXT PRIMARY KEY   // msg_*
  session_id     TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE
  admitted_seq   INTEGER NOT NULL
  promoted_seq   INTEGER
  prompt         JSON NOT NULL
  delivery       TEXT NOT NULL
  time_created   INTEGER NOT NULL

  UNIQUE(session_id, admitted_seq)
  UNIQUE(session_id, promoted_seq) WHERE promoted_seq IS NOT NULL
  INDEX(session_id, promoted_seq, delivery, admitted_seq)
```

For a promoted prompt:

```text
session_input.promoted_seq === session_message.seq
```

## Cutover

Use a coordinated experimental reset, not an uncoordinated local projection
reset:

```text
reset
  event
  event_sequence
  session_input
  session_message

preserve local V1 rows
  session
  message
  part
```

Hard-fence experimental workspace sync and discard or recreate remote beta
workspaces before replay resumes. Otherwise a stale workspace can replay old
history back into the emptied log.

Retained pre-cutover Sessions remain locally readable but are not self-contained
replay sources. New suffix events do not restore their missing Session root.
Sessions created after the reset can replay normally.

## Implementation

| Slice | Scope                                                                                                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Add admitted/promoted events, transactional idempotent admission, lifecycle-table rebuild, minimal receipts and `sessions.inputs(...)`, strict replay equality, reducer dedupe, and fresh-target reconstruction proof. |
| 2     | Decide whether same-store reprojection is required.                                                                                                                                                                    |
| Later | Activity identity, retry/abandon, interruption, startup scanning, and clustered execution ownership.                                                                                                                   |

## TDD Contract

| ID          | Required invariant                                                                                               | Future test                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `REQ-01`    | Every accepted prompt appends exactly one `PromptAdmitted`.                                                      | Submit one prompt and assert one event plus one lifecycle row.                                         |
| `REQ-02`    | Optional caller ID controls retry identity. Omitted IDs create new lifecycles.                                   | Retry with and without supplied IDs.                                                                   |
| `REQ-03`    | Same `msg_*` plus same intent is idempotent, including concurrent retries.                                       | Submit two concurrent equivalent requests and assert one event plus equal receipts.                    |
| `REQ-04`    | Reusing `msg_*` with different Session, prompt, or delivery fails.                                               | Retry each conflicting variant and assert `PromptConflictError`.                                       |
| `REQ-06`    | Promotion is atomic and happens at most once.                                                                    | Race repeated wakes and assert one promotion event, one `promoted_seq`, and one timeline row.          |
| `REQ-08`    | `msg_*` is globally reserved across lifecycle and transcript rows.                                               | Reject prompt/non-prompt cross-table ID collisions.                                                    |
| `REQ-10`    | Admission order and timeline order remain distinct.                                                              | Admit older queue then newer steer; assert steer promotes first while queue stays pending.             |
| `REQ-13/14` | Stale replay is a no-op only for an equivalent fact.                                                             | Accept an exact stale prefix; reject divergent payload, type, position, or reused `evt_*`.             |
| `REQ-15`    | Connected reducers tolerate at-least-once durable delivery.                                                      | Deliver each durable `evt_*` twice and apply it once.                                                  |
| `REQ-16/17` | Fresh-target replay rebuilds pending prompts but never executes work.                                            | Replay an admitted queue into a staged empty target and assert pending state with zero provider calls. |
| `REQ-18`    | Ambiguous provider or tool work never auto-retries from replay or an ordinary background wake.                   | Replay unresolved activity, wake it without a new prompt, and assert zero repeated side effects.       |
| `REQ-18A`   | A newly submitted prompt authorizes a fresh continuation from durable history.                                   | Crash after ambiguous provider dispatch, submit a new prompt, and assert one fresh provider turn.      |
| `REQ-19`    | Experimental workspace sync remains disabled during cutover.                                                     | Attempt stale remote beta replay while disabled and assert rejection.                                  |
| `REQ-20/21` | Cutover discards stale beta history, preserves local V1 rows, and keeps retained Sessions local-only for replay. | Reset beta state, preserve V1 rows, and reject retained-Session fresh-target replay.                   |
| `REQ-22`    | The V1 compatibility bridge cannot leave V2 half-promoted.                                                       | Remove the bridge or fault-inject its atomic admitted-plus-promoted transition.                        |

## Open Decisions

1. Does bare explicit `sessions.resume(...)`, without a new prompt, authorize
   continuation after ambiguous prior provider work?
2. Can the temporary V1 prompt bridge be removed, or must it atomically append
   admission plus promotion during cutover?

## PR Direction

PR `#30759` is superseded. Start replacement work from `origin/dev`; do not
cherry-pick its broad reversible `evt_* <-> msg_*` identity commit.
