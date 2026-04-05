## 2026-04-05 Task 1: STOP GATE Override — PROCEED

T1 subagent recommended STOP because bus events lack `id`, `seq`, `origin` metadata.

**Override rationale:**
1. **Event table on hooks path**: NOT NEEDED. The event table was for SSE dedup. Hooks fire once per event — no dedup required. T4 will handle this explicitly.
2. **replication_state.last_event_id/last_seq**: NOT NEEDED for live hooks. Backfill still reads local SQLite EventTable (which has these fields). Live hooks don't need SSE-style checkpointing.
3. **session.origin_machine**: Use `options.machine` or `os.hostname()` instead. On the hooks path, ALL events are local (hooks only fire for local bus events). The origin IS the local machine. This is correct behavior.

**What T2 needs to know:**
- replay() can skip the event table write for bus events (or make it optional)
- For session.created/updated, set origin_machine = options.machine (local) instead of reading from event
- aggregateID is derivable from properties.sessionID for all needed events
- message.part.delta can be IGNORED — message.part.updated provides full snapshots

## 2026-04-05 Task 4: replication.ts — No Changes Needed

The hooks path (replayBus) does NOT use replication.ts at all:
- No event table writes (bus events lack seq/id)
- No replication_state tracking (hooks fire once, no SSE reconnection)
- No source() calls (machine is always local, passed as parameter to replayBus)

The backfill path continues to use replication.ts unchanged via old replay().
