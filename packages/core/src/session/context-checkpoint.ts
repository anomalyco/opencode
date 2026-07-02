export * as SessionContextCheckpoint from "./context-checkpoint"

import { eq } from "drizzle-orm"
import { DateTime, Effect, Option, Schema } from "effect"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { SystemContext } from "../system-context/index"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextCheckpointTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decodeApplied = Schema.decodeUnknownOption(SystemContext.Applied)

/**
 * Loads or creates the session's durable context checkpoint, narrating any
 * drift since the model was last told as a chronological update. Completed
 * compaction rebaselines; nothing else rewrites the baseline. Runs before
 * input promotion so a blocked first turn leaves pending inputs untouched.
 */
export const prepare = Effect.fn("SessionContextCheckpoint.prepare")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
) {
  const [value, stored, compaction] = yield* Effect.all(
    [context, find(db, sessionID), SessionHistory.latestCompaction(db, sessionID)],
    { concurrency: "unbounded" },
  )
  if (!stored) {
    const baseline = yield* SystemContext.initialize(value)
    const baselineSeq = yield* insert(db, sessionID, baseline)
    return { baseline: baseline.text, baselineSeq }
  }

  // The applied record is comparison state only; an undecodable one heals by
  // treating every source as new, re-announcing baselines as updates.
  const applied = Option.getOrElse(decodeApplied(stored.snapshot), () => ({}))
  if (compaction !== undefined && compaction.seq > stored.baseline_seq) {
    const baseline = yield* SystemContext.rebaseline(value, applied)
    yield* rewrite(db, sessionID, compaction.seq, baseline)
    return { baseline: baseline.text, baselineSeq: compaction.seq }
  }
  const result = yield* SystemContext.reconcile(value, applied)
  if (result._tag === "Unchanged") return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }

  yield* events.publish(
    SessionEvent.ContextUpdated,
    { sessionID, messageID: SessionMessage.ID.create(), timestamp: yield* DateTime.now, text: result.text },
    { commit: () => advance(db, sessionID, result.applied).pipe(Effect.orDie) },
  )
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

export const reset = Effect.fn("SessionContextCheckpoint.reset")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  yield* db
    .delete(SessionContextCheckpointTable)
    .where(eq(SessionContextCheckpointTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

const find = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionContextCheckpointTable)
    .where(eq(SessionContextCheckpointTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

const insert = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baseline: SystemContext.Baseline,
) {
  const baselineSeq = yield* EventV2.latestSequence(db, sessionID)
  yield* db
    .insert(SessionContextCheckpointTable)
    .values({
      session_id: sessionID,
      baseline: baseline.text,
      snapshot: baseline.applied,
      baseline_seq: baselineSeq,
    })
    .run()
    .pipe(Effect.orDie)
  return baselineSeq
})

const rewrite = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
  baseline: SystemContext.Baseline,
) {
  const updated = yield* db
    .update(SessionContextCheckpointTable)
    .set({
      baseline: baseline.text,
      snapshot: baseline.applied,
      baseline_seq: baselineSeq,
    })
    .where(eq(SessionContextCheckpointTable.session_id, sessionID))
    .returning({ sessionID: SessionContextCheckpointTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die("Context checkpoint not found")
})

const advance = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  applied: SystemContext.Applied,
) {
  const updated = yield* db
    .update(SessionContextCheckpointTable)
    .set({ snapshot: applied })
    .where(eq(SessionContextCheckpointTable.session_id, sessionID))
    .returning({ sessionID: SessionContextCheckpointTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die("Context checkpoint not found")
})
