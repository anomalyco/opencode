# ADR-0006: Move queue serialization from in-process locks to DB compare-and-swap

- Status: Proposed
- Date: 2026-05-21

## Context

The Prompt Queue (see CONTEXT.md) is serialised by an **in-process** Map:

```ts
// packages/collab/src/queue.ts:17
private locks = new Map<string /* collabSessionId */, boolean>()
```

The executor flips a suggestion's status from `approved` to `submitted`
inside the executor:

```ts
// packages/opencode/src/collab/router.ts:108 (paraphrased)
Suggestion.markSubmitted(suggestion.id)
```

There is no SQL guard that the row was still `approved` at write time.

Two failure modes follow:

1. **Crash mid-dispatch loses the prompt or runs it twice.**  If the Bun
   process dies after the executor fetched the head item but before the
   `prompt_async` self-fetch (router.ts:330-343) completes, status may be
   either `approved` (will be re-dispatched on next event) or `submitted`
   (LLM already received it).  There is no idempotency key and no startup
   sweep — the next collab request lazily re-registers the executor via
   `ensureQueueRegistered` (router.ts:126-133), which then picks up the
   item again.
2. **Multiple replicas would each dispatch every prompt.**  Two ECS tasks
   would each register their own per-session executor against the same DB
   and both would see the same `approved` head item; nothing in SQL
   prevents both from sending it.  ADR-0009 keeps the deployment single-
   replica precisely because of this property.

The lock is also lost on every restart, leaving in-flight items in
indeterminate state.

## Decision

Serialise dispatch through SQL, not memory:

- Add `dispatched_at INTEGER` to `collab_suggestion` (already partially
  represented as the status transition; promote it to a real column).
- Make the `approved` → `submitted` transition a single SQL statement with a
  compare-and-swap:

  ```sql
  UPDATE collab_suggestion
     SET status = 'submitted',
         dispatched_at = :now
   WHERE id = :id AND status = 'approved' AND dispatched_at IS NULL
  ```

  The executor proceeds only when `changes() == 1`.  If it's 0, another
  process or another fiber already took the row.
- Promote `idempotency_key` to a column on `collab_suggestion`.  The native
  opencode session call carries this key.  The native session refuses to run
  a second prompt with the same key (handled at the HTTP API layer with a
  short-lived in-memory set keyed by `<nativeSessionId, idempotency_key>`).
- On startup, the server runs a sweep:
  `UPDATE collab_suggestion SET status='approved' WHERE status='submitted'
  AND dispatched_at < now - <STALE_MS>` to recover prompts whose dispatcher
  died.  Drivers see a single "re-dispatched after server restart" toast.

The in-memory `locks` map remains as a hot-path optimisation but is no longer
the source of truth.

## Consequences

**Positive**

- A restart no longer loses or duplicates prompts.
- Removes the implicit "single replica or you double-dispatch" constraint
  from the queue layer.  Multi-replica still requires solving SSE fanout and
  EFS-vs-Postgres (ADR-0009), but the queue stops being the blocker.
- Makes dispatch debuggable: `dispatched_at` is a real timestamp, not a
  fleeting in-memory state.

**Negative**

- One extra SQL write per dispatch (sub-millisecond at expected volumes).
- Idempotency-key plumbing into the opencode HttpApi is a small new feature;
  see "Alternatives" for a path that defers it.

## Alternatives considered

- **Keep status transitions in-process, add only the startup sweep.**
  Plausible interim step; resolves the "lose prompt on crash" case but does
  not enable multi-replica.  Could land first, then upgrade to full CAS.
- **Move to a real job queue (Redis / SQS).**  Overkill for current volumes;
  introduces another infrastructure dependency.  Reconsider once Postgres
  arrives (ADR-0009).
- **Accept the current behaviour.**  Rejected because a clean restart should
  not cost users their pending prompts, and because the doubled-dispatch
  failure mode is silent (no error, just a duplicate LLM message).
