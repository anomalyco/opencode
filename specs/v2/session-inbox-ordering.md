# Session Inbox And Transcript Ordering

This is the proposed V2 model for prompt admission, visible transcript history,
and optimistic TUI rendering.

## 1. Before The Inbox

Before the embedded V2 runner slice, a new prompt was written directly into
visible transcript history. The loop reloaded history and inferred whether work
remained by comparing the latest user and assistant messages.

```text
User                    Transcript             Loop                                      Model
  │                          │                   │                                         │
  ├─ append visible prompt ──▶                   │                                         │
  │                          │                   │                                         │
  │                          ◀─ reload history ──┤                                         │
  │                          │                   │                                         │
  │                          │                   ├────────────────────────────────────╮    │
  │                          │                   │ compare latest user and assistant  │    │
  │                          │                   ◀────────────────────────────────────╯    │
  │                          │                   │                                         │
  │                          │                   ├─ continue if newer user work exists ────▶
  │                          │                   │                                         │
```

This made accepted input and model-visible history the same thing. It also made
message ID ordering carry more responsibility than it should.

## 2. Proposed V2 Model

V2 separates accepted input from visible transcript history:

```text
session_input
  -> durable receipt for accepted user intent
  -> ordered by admission seq
  -> pending until promoted

session_message
  -> canonical model-visible transcript
  -> ordered by seq
  -> contains only promoted messages

event
  -> canonical durable Session event log
  -> event.seq is copied into session_message.seq when a row first appears
```

```text
User                        Inbox                        Runner          Transcript           Model
  │                           │                             │                 │                 │
  ├─ admit prompt(delivery) ──▶                             │                 │                 │
  │                           │                             │                 │                 │
  ◀─ durable receipt ─────────┤                             │                 │                 │
  │                           │                             │                 │                 │
  │                           │                             │                 │                 │
  │                 not model-visible yet                   │                 │                 │
  │                           │                             │                 │                 │
  │                           ◀─ promote at safe boundary ──┤                 │                 │
  │                           │                             │                 │                 │
  │                           ├─ append Prompted(seq) ────────────────────────▶                 │
  │                           │                             │                 │                 │
  │                           │                             ├─ reload visible transcript ───────▶
  │                           │                             │                 │                 │
```

The two sequence fields answer different questions:

| Field                 | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `session_input.seq`   | In what order did OpenCode accept pending inputs?                          |
| `session_message.seq` | At what durable Session event position did this row enter visible history? |

`session_message.seq` is immutable. Later text, tool, or settlement events may
update a projected assistant row without moving it through the transcript.

```ts
/**
 * Immutable aggregate sequence of the durable event that first projected this
 * visible transcript row. Later events may update the row data but never move it.
 */
seq: integer().notNull()
```

## 3. Optimistic Steer Rendering

A default `steer` input joins the active activity at the next safe provider-turn
boundary. The TUI can show it inline immediately as pending, then reconcile that
same row in place when promotion assigns the canonical transcript `seq`.

```text
User               TUI                              Inbox                     Runner          Transcript
  │                 │                                 │                          │                 │
  ├─ submit steer ──▶                                 │                          │                 │
  │                 │                                 │                          │                 │
  │                 ├─ admit ─────────────────────────▶                          │                 │
  │                 │                                 │                          │                 │
  │                 ├────────────────────────────╮    │                          │                 │
  │                 │ render inline pending row  │    │                          │                 │
  │                 ◀────────────────────────────╯    │                          │                 │
  │                 │                                 │                          │                 │
  │                 │                                 ◀─ promote at checkpoint ──┤                 │
  │                 │                                 │                          │                 │
  │                 │                                 ├─ append same id with seq ──────────────────▶
  │                 │                                 │                          │                 │
  │                 ◀─ reconcile same row in place ────────────────────────────────────────────────┤
  │                 │                                 │                          │                 │
```

Breadboard sketch while the assistant is still streaming:

```text
┌─────────────────────────────────────────────────────────────┐
│ assistant                                            live ▌ │
│ I found the migration issue. I am checking Windows too...   │
├─────────────────────────────────────────────────────────────┤
│ you                                      pending steer ↗    │
│ Keep the fix minimal and add a regression test.             │
└─────────────────────────────────────────────────────────────┘
```

After the checkpoint, the row stays where it appeared:

```text
┌─────────────────────────────────────────────────────────────┐
│ assistant                                                   │
│ I found the migration issue. I am checking Windows too...   │
├─────────────────────────────────────────────────────────────┤
│ you                                                         │
│ Keep the fix minimal and add a regression test.             │
├─────────────────────────────────────────────────────────────┤
│ assistant                                            live ▌ │
│ I will keep the patch narrow and add the regression now...  │
└─────────────────────────────────────────────────────────────┘
```

The stable input ID lets the TUI replace pending state with the promoted
`session_message` row instead of inserting a second bubble.

## 4. Queued Inputs Stay Separate

An explicit `queue` input belongs to a future activity. The TUI should show it in
a queue tray until the current activity settles. Only then does the runner promote
one queued input into visible transcript history.

```text
User               TUI                         Inbox                           Runner                           Transcript
  │                 │                            │                                │                                  │
  ├─ submit queue ──▶                            │                                │                                  │
  │                 │                            │                                │                                  │
  │                 ├─ admit ────────────────────▶                                │                                  │
  │                 │                            │                                │                                  │
  │                 ├───────────────────────╮    │                                │                                  │
  │                 │ render in queue tray  │    │                                │                                  │
  │                 ◀───────────────────────╯    │                                │                                  │
  │                 │                            │                                │                                  │
  │                 │                            │                                ├───────────────────────────╮      │
  │                 │                            │                                │ current activity settles  │      │
  │                 │                            │                                ◀───────────────────────────╯      │
  │                 │                            │                                │                                  │
  │                 │                            ◀─ promote oldest queued input ──┤                                  │
  │                 │                            │                                │                                  │
  │                 │                            ├─ append Prompted(seq) ────────────────────────────────────────────▶
  │                 │                            │                                │                                  │
  │                 ◀─ move row into transcript ─────────────────────────────────────────────────────────────────────┤
  │                 │                            │                                │                                  │
```

```text
┌──────────────────────────────────────────────┬──────────────────────────────┐
│ transcript                                   │ queued · 2                   │
│                                              │                              │
│ assistant                            live ▌  │ 1. Run the full test suite.  │
│ I am fixing the migration now...             │ 2. Then open a PR.           │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

After the current activity settles, promote one queued input:

```text
┌──────────────────────────────────────────────┬──────────────────────────────┐
│ transcript                                   │ queued · 1                   │
│                                              │                              │
│ assistant                                    │ 1. Then open a PR.           │
│ The migration fix is complete.               │                              │
│                                              │                              │
│ you                                          │                              │
│ Run the full test suite.                     │                              │
│                                              │                              │
│ assistant                            live ▌  │                              │
│ Running the suite now...                     │                              │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

## 5. Why Store Transcript `seq`

IDs identify rows. Timestamps describe authored time. Neither is canonical
visible-history order once admission and promotion are separate.

Storing the creator event sequence directly on the `session_message` projection:

- keeps context assembly and pagination indexed on the smaller transcript table
- keeps compaction boundaries aligned with durable Session order
- avoids scanning the denser event log before every provider turn
- lets future event retention differ from transcript retention

The pending inbox is not a complication caused by transcript `seq`. It is the
domain model: accepted input and model-visible history are separate lifecycle
stages.

## 6. Migration Boundary

Historical experimental builds could write `session_message` rows without durable
creator events. Those rows cannot be assigned truthful transcript order.

Before V2 launch, reset only that experimental projection before adding `seq`:

```sql
DELETE FROM session_message;
ALTER TABLE session_message ADD COLUMN seq INTEGER NOT NULL;
```

Canonical V1 history remains in `message` and `part`.

## Proposed Client Contract

The storage split should stay internal. A TUI-facing snapshot can combine both
lanes explicitly:

```ts
type SessionTimeline = {
  messages: SessionMessage[]
  pendingInputs: SessionInputReceipt[]
}
```

Render promoted messages in transcript `seq` order. Render pending steers inline
and queued inputs in the queue tray. Reconcile pending rows by stable input ID when
promotion creates the canonical transcript row.
