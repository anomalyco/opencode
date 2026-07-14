# Instruction Sync: V2 Architecture

Status: implemented on `instruction-sync-v2` (2026-07-10).

## Principle

The model is a replica that OpenCode can write but cannot read or edit. The transcript is the one-way channel. Instruction sync keeps mutable privileged context (`AGENTS.md`, guidance, API entries, date, and environment) current over that channel without rewriting text that was already sent.

**The durable log stores only irreducible facts: which source values changed, and when. Everything else is a function of the log and current renderer code.**

## Durable Fact

```typescript
"session.instructions.updated.2" {
  sessionID: Session.ID
  delta: Record<Instructions.Key, Instructions.Hash | "removed">
}
```

A hash overwrites one source value. The literal `"removed"` removes it (chosen over JSON `null` because record-value nullability does not survive every client generator; it cannot collide with a 64-hex hash). The event stores no rendered text, mode, baseline, or snapshot.

Each hash body is canonical JSON stored once in the machine-local `instruction_blob` table. Hashes are local pointers, not cross-machine promises.

## Epochs And Folds

An instruction epoch is the span between completed compactions. `epochStart` is the sequence of the last `session.compaction.ended`, or the initial complete v2 delta when no epoch exists.

Folding deltas in durable sequence order derives:

```text
values through epochStart  -> renderInitial -> initial instructions
each delta after epochStart -> renderUpdate  -> chronological System message
final values                                  -> next boundary comparison state
```

Completed compaction moves the epoch by copying current hashes to initial hashes at the exact ended-event sequence. It does not read sources or publish an instruction event.

Session movement and committed revert clear the fold. The next boundary must establish one complete delta before input promotion.

## Projection Cache

```text
instruction_state
  session_id
  epoch_start
  through_seq
  initial_values
  current_values
```

This row is derived state. The boundary compares `through_seq` with the latest relevant durable sequence. A missing or stale row folds the log and rewrites the cache without publishing an event.

The relevant reducer inputs are:

- `session.instructions.updated.2`: apply the delta; the first one establishes an epoch, including an empty complete delta.
- `session.compaction.ended.1`: make current values initial and move `epochStart`.
- `session.moved.1`: clear values.
- `session.revert.committed.1`: clear values.
- `session.forked.2`: derive from parent ancestry through its frozen `parentSeq`.

## Sources

```typescript
interface Source {
  readonly key: Key
  readonly read: Effect<Json | Unavailable | Removed>
  readonly initial: (value: Json) => string | undefined
  readonly changed: (previous: Json, current: Json) => string | undefined
  readonly removed: (previous: Json) => string | undefined
}

namespace Source {
  interface Definition<A> {
    readonly key: Key
    readonly codec: Schema.Codec<A, Json>
    readonly read: Effect<A | Unavailable | Removed>
    readonly render: {
      readonly initial: (value: A) => string
      readonly changed: (previous: A, current: A) => string
      readonly removed?: (previous: A) => string
    }
  }
}

type Instructions = ReadonlyArray<Source>

declare function make<A>(definition: Source.Definition<A>): Instructions
```

Producers author a typed `Source.Definition<A>`. `make` captures its codec and renderers in one JSON-level `Source`, the representation used for heterogeneous composition, durable values, and historical rendering. `Instructions` is an ordered collection of those sources; combining collections preserves order and rejects duplicate keys.

`read` runs once per source at the safe boundary, never at layer construction or request assembly. Codecs must be canonical: object keys are canonicalized by the hash function, while source-owned collections must have deterministic order and values must not contain observation timestamps.

`Unavailable` means the read failed temporarily. The initial complete delta blocks while any source is unavailable; later boundaries retain its prior hash silently.

`Removed` is an observed absence. If the key currently has a value, the next delta stores `"removed"` and assembly calls the source's removal renderer. A source that disappears from a software upgrade does not imply removal; its retained value becomes invisible while its renderer is absent.

## Safe Boundary

Once per physical attempt, before input promotion:

1. Load the selected agent and compose built-ins, discovery, skill guidance, reference guidance, MCP guidance, and API entries in fixed order.
2. Read every source concurrently exactly once.
3. Encode and hash values; compare with `instruction_state.current_values`.
4. At the initial v2 boundary, require a complete read and admit one complete delta, including `{}` for a truly empty set.
5. For later boundaries, insert new blobs and admit one delta only when a hash or explicit removal changed.
6. Promote pending input.
7. Read projected messages, epoch values, blobs, and post-epoch deltas in one database transaction.
8. Render initial instructions and interleave derived update messages by durable sequence.

`MoveSession` interrupts any active drain and awaits idle before publishing `session.moved`, matching the best-effort ordering used by Session removal.

The blob inserts, durable event, and fold-cache advance share the event transaction.

## Forks

`session.forked.2` carries `parentSeq`, the authoritative parent event cutoff. For a fork before message N, the cutoff is `message.seq - 1`, so instruction changes admitted immediately before that message are inherited while later parent state is not.

The child stores the cutoff as `session.fork_seq`. Its virtual instruction log is the parent's ancestry through that cutoff followed by child events. Child event sequence reservation begins after the cutoff, preserving chronological interleaving with copied message rows. Replay accepts the intentional fork gap because the fork projector reserves the inherited prefix before later child events replay.

## API Entries

Each visible entry is one `api/<key>` source. DELETE marks the row as a hidden tombstone rather than physically removing it, preserving the renderer needed to admit and narrate the removal; list responses hide tombstones. The nullable value column preserves JSON `null`, while the separate tombstone flag distinguishes removal. A later PUT revives the same source.

PUT measures encoded JSON in UTF-8 and rejects values larger than 8KB with `InstructionEntryValueTooLargeError` (HTTP 413). Values are never truncated.

## Content-Addressed Storage

The blob store grows by one row per distinct encoded value. No GC ships initially. This is an at-rest deduplication policy; deleting a Session does not remove values only that Session referenced, so clients must not put secrets in API entries.

If retention becomes necessary, add mark-and-sweep: walk live v2 deltas for referenced hashes and delete the rest. No schema change or eager reference counter is required.

The blob store is machine/tenant scoped and must never deduplicate across tenants.

**Storage format is not wire format.** Any future V2 sync, export, share, or workspace-transfer boundary must hydrate referenced values, verify each body against its hash on ingestion, and insert blobs before replaying the event. Current V2 has no cross-machine durable replay surface; hashes are sufficient for local event logs and key-only clients.

## Client Projection

Instruction deltas do not project `session_message` rows. The TUI derives a non-model-facing notice from event keys, for example `Instructions updated: core/date, api/plan`. Model-facing update prose exists only during runner assembly and is excluded from compaction summaries.

## Migration

Migration deletes pre-beta `session.instructions.updated.1` events and their event-derived System rows, then drops `instruction_checkpoint`. It leaves unrelated events and System messages intact. The next safe boundary establishes one complete v2 delta.

Existing `session.forked.1` rows migrate to v2 with the event prefix reserved by their original projection as `parentSeq`.

## Accepted Costs

- Renderer changes can change request bytes for identical stored values, causing one provider-cache miss. They do not create an instruction delta.
- Rendered text is not retained verbatim.
- Source additions or software removals are silent unless a source explicitly reads `Removed`.
- Clients display changed keys, not privileged prose.
- Blob GC is deferred.
- Pre-beta instruction events are deleted during migration; logs with resulting sequence gaps are not guaranteed to replay into a blank database.
