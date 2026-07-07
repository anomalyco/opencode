export * as InstructionCheckpoint from "./instruction-checkpoint"

import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { Instructions } from "../instructions/index"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionSchema } from "./schema"
import { InstructionCheckpointTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decodeApplied = Schema.decodeUnknownOption(Instructions.Applied)

/**
 * Loads or creates the session's durable instruction checkpoint, narrating any
 * drift since the model was last told as a chronological update. Completed
 * compaction rebaselines; nothing else rewrites the baseline. Runs before
 * input promotion so a blocked first step leaves pending inputs untouched.
 */
export const prepare = Effect.fn("InstructionCheckpoint.prepare")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  instructions: Effect.Effect<Instructions.Instructions>,
  sessionID: SessionSchema.ID,
) {
  const [value, stored, compaction] = yield* Effect.all(
    [instructions, find(db, sessionID), SessionHistory.latestCompaction(db, sessionID)],
    { concurrency: "unbounded" },
  )
  if (!stored) {
    const baseline = yield* Instructions.initialize(value)
    const baselineSeq = yield* insert(db, sessionID, baseline)
    return { baseline: baseline.text, baselineSeq }
  }

  // The applied record is comparison state only; an undecodable one heals by
  // treating every source as new, re-announcing baselines as updates.
  const applied = Option.getOrElse(decodeApplied(stored.snapshot), () => ({}))
  if (compaction !== undefined && compaction.seq > stored.baseline_seq) {
    const baseline = yield* Instructions.rebaseline(value, applied)
    yield* rewrite(db, sessionID, compaction.seq, baseline)
    return { baseline: baseline.text, baselineSeq: compaction.seq }
  }
  const result = yield* Instructions.reconcile(value, applied)
  if (result._tag === "Unchanged") return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }

  yield* events.publish(
    SessionEvent.InstructionsUpdated,
    { sessionID, text: result.text },
    { commit: () => advance(db, sessionID, result.applied).pipe(Effect.orDie) },
  )
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

export const reset = Effect.fn("InstructionCheckpoint.reset")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  yield* db
    .delete(InstructionCheckpointTable)
    .where(eq(InstructionCheckpointTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

const find = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(InstructionCheckpointTable)
    .where(eq(InstructionCheckpointTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

const insert = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baseline: Instructions.Baseline,
) {
  const baselineSeq = yield* EventV2.latestSequence(db, sessionID)
  yield* db
    .insert(InstructionCheckpointTable)
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
  baseline: Instructions.Baseline,
) {
  const updated = yield* db
    .update(InstructionCheckpointTable)
    .set({
      baseline: baseline.text,
      snapshot: baseline.applied,
      baseline_seq: baselineSeq,
    })
    .where(eq(InstructionCheckpointTable.session_id, sessionID))
    .returning({ sessionID: InstructionCheckpointTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(new Error("Instruction checkpoint not found"))
})

const advance = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  applied: Instructions.Applied,
) {
  const updated = yield* db
    .update(InstructionCheckpointTable)
    .set({ snapshot: applied })
    .where(eq(InstructionCheckpointTable.session_id, sessionID))
    .returning({ sessionID: InstructionCheckpointTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(new Error("Instruction checkpoint not found"))
})
