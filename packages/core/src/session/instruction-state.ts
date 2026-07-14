export * as InstructionState from "./instruction-state"

import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm"
import { DateTime, Effect, Option, Schema } from "effect"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { Instructions } from "../instructions/index"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { InstructionBlobTable, InstructionStateTable, SessionTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decodeInstructionsUpdated = Schema.decodeUnknownSync(SessionEvent.InstructionsUpdated.data)

export const prepare = Effect.fn("InstructionState.prepare")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  instructions: Instructions.Instructions,
  sessionID: SessionSchema.ID,
) {
  const [observed, stored] = yield* Effect.all([Instructions.read(instructions), ensure(db, sessionID)], {
    concurrency: "unbounded",
  })
  const admission = yield* Instructions.diff(observed, stored?.current_values)
  if (!stored || Object.keys(admission.delta).length > 0) {
    yield* events.publish(
      SessionEvent.InstructionsUpdated,
      { sessionID, delta: admission.delta },
      {
        commit: () => insertBlobs(db, admission.blobs),
      },
    )
  }
})

export const apply = Effect.fn("InstructionState.apply")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  seq: number,
  delta: Instructions.Delta,
) {
  const stored = yield* find(db, sessionID)
  const current = Instructions.applyHashDelta(stored?.current_values ?? {}, delta)
  if (!stored) {
    yield* db
      .insert(InstructionStateTable)
      .values({
        session_id: sessionID,
        epoch_start: seq,
        through_seq: seq,
        initial_values: current,
        current_values: current,
      })
      .run()
      .pipe(Effect.orDie)
    return
  }
  yield* db
    .update(InstructionStateTable)
    .set({ through_seq: seq, current_values: current })
    .where(eq(InstructionStateTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const advanceEpoch = Effect.fn("InstructionState.advanceEpoch")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  epochStart: number,
) {
  yield* db
    .update(InstructionStateTable)
    .set({
      epoch_start: epochStart,
      through_seq: epochStart,
      initial_values: sql`${InstructionStateTable.current_values}`,
    })
    .where(eq(InstructionStateTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const reset = Effect.fn("InstructionState.reset")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  yield* db
    .delete(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const rebuild = Effect.fn("InstructionState.rebuild")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const folded = fold(yield* instructionEvents(db, sessionID))
  if (!folded) {
    yield* reset(db, sessionID)
    return undefined
  }
  const state = {
    session_id: sessionID,
    epoch_start: folded.epochStart,
    through_seq: folded.throughSeq,
    initial_values: folded.initial,
    current_values: folded.current,
  }
  yield* db
    .insert(InstructionStateTable)
    .values(state)
    .onConflictDoUpdate({
      target: InstructionStateTable.session_id,
      set: {
        epoch_start: folded.epochStart,
        through_seq: folded.throughSeq,
        initial_values: folded.initial,
        current_values: folded.current,
      },
    })
    .run()
    .pipe(Effect.orDie)
  return state
})

export const assemble = Effect.fn("InstructionState.assemble")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.Instructions,
) {
  const state = yield* find(db, sessionID)
  if (!state) return yield* Effect.die(new Error(`Instruction state not found during assembly: ${sessionID}`))
  const rows = yield* instructionUpdatesAfter(db, sessionID, state.epoch_start)
  const updates = rows.map((row) => ({
    row,
    delta: decodeInstructionsUpdated(row.data).delta,
  }))
  const blobs = yield* loadBlobs(db, [
    ...Object.values(state.initial_values),
    ...updates.flatMap((update) =>
      Object.values(update.delta).filter((hash): hash is Instructions.Hash => hash !== "removed"),
    ),
  ])
  const valuesAtStart = dereference(state.initial_values, blobs)
  let values = valuesAtStart
  const result: Array<{ readonly seq: number; readonly message: SessionMessage.System }> = []
  for (const update of updates) {
    const delta = dereferenceDelta(update.delta, blobs)
    const text = Instructions.renderUpdate(instructions, values, delta)
    if (text.length > 0)
      result.push({
        seq: update.row.seq,
        message: SessionMessage.System.make({
          id: SessionMessage.ID.fromEvent(EventV2.ID.make(update.row.id)),
          type: "system",
          text,
          time: { created: DateTime.makeUnsafe(update.row.created) },
        }),
      })
    values = Instructions.applyDelta(values, delta)
  }
  return { initial: Instructions.renderInitial(instructions, valuesAtStart), updates: result }
})

const find = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

const ensure = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const stored = yield* find(db, sessionID)
  if (!stored) return yield* rebuild(db, sessionID)
  const latest = yield* db
    .select({ seq: EventTable.seq })
    .from(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), inArray(EventTable.type, relevantEventTypes)))
    .orderBy(desc(EventTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!latest || latest.seq <= stored.through_seq) return stored
  return yield* rebuild(db, sessionID)
})

const insertBlobs = Effect.fnUntraced(function* (db: DatabaseService, blobs: Readonly<Record<string, Schema.Json>>) {
  const rows = Object.entries(blobs).map(([hash, value]) => ({ hash: Instructions.Hash.make(hash), value }))
  if (rows.length === 0) return
  yield* db.insert(InstructionBlobTable).values(rows).onConflictDoNothing().run().pipe(Effect.orDie)
})

const loadBlobs = Effect.fnUntraced(function* (db: DatabaseService, values: ReadonlyArray<Instructions.Hash>) {
  const hashes = [...new Set(values)]
  const batches = Array.from({ length: Math.ceil(hashes.length / 500) }, (_, index) =>
    hashes.slice(index * 500, (index + 1) * 500),
  )
  const rows = (yield* Effect.forEach(
    batches,
    (batch) =>
      db.select().from(InstructionBlobTable).where(inArray(InstructionBlobTable.hash, batch)).all().pipe(Effect.orDie),
    { concurrency: 4 },
  )).flat()
  const blobs = new Map(rows.map((row) => [row.hash, row.value]))
  for (const hash of hashes) {
    if (!blobs.has(hash)) return yield* Effect.die(new Error(`Instruction blob not found: ${hash}`))
  }
  return blobs
})

function dereference(values: Instructions.Values, blobs: ReadonlyMap<Instructions.Hash, Schema.Json>) {
  return Object.fromEntries(Object.entries(values).map(([key, hash]) => [key, requireBlob(blobs, hash)])) as Readonly<
    Record<string, Schema.Json>
  >
}

function dereferenceDelta(delta: Instructions.Delta, blobs: ReadonlyMap<Instructions.Hash, Schema.Json>) {
  return Object.fromEntries(
    Object.entries(delta).map(([key, hash]) => [
      key,
      hash === "removed" ? Option.none() : Option.some(requireBlob(blobs, hash)),
    ]),
  ) as Readonly<Record<string, Option.Option<Schema.Json>>>
}

function requireBlob(blobs: ReadonlyMap<Instructions.Hash, Schema.Json>, hash: Instructions.Hash) {
  const value = blobs.get(hash)
  if (value === undefined) throw new Error(`Instruction blob not found: ${hash}`)
  return value
}

const instructionEventType = EventV2.versionedType(
  SessionEvent.InstructionsUpdated.type,
  SessionEvent.InstructionsUpdated.durable.version,
)
const compactionEventType = EventV2.versionedType(
  SessionEvent.Compaction.Ended.type,
  SessionEvent.Compaction.Ended.durable.version,
)
const movedEventType = EventV2.versionedType(SessionEvent.Moved.type, SessionEvent.Moved.durable.version)
const revertedEventType = EventV2.versionedType(
  SessionEvent.RevertEvent.Committed.type,
  SessionEvent.RevertEvent.Committed.durable.version,
)
const relevantEventTypes = [instructionEventType, compactionEventType, movedEventType, revertedEventType]

type InstructionEventRow = typeof EventTable.$inferSelect

const instructionEvents = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
): Effect.fn.Return<ReadonlyArray<InstructionEventRow>> {
  return yield* eventRows(db, sessionID, relevantEventTypes)
})

const instructionUpdatesAfter = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  after: number,
) {
  return yield* eventRows(db, sessionID, [instructionEventType], after)
})

const eventRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  types: ReadonlyArray<string>,
  after?: number,
): Effect.fn.Return<ReadonlyArray<InstructionEventRow>> {
  const segments = (yield* lineage(db, sessionID)).filter(
    (segment) => after === undefined || segment.through === undefined || segment.through > after,
  )
  return (yield* Effect.forEach(segments, (segment) =>
    db
      .select()
      .from(EventTable)
      .where(
        and(
          eq(EventTable.aggregate_id, segment.sessionID),
          inArray(EventTable.type, types),
          segment.through === undefined ? undefined : lte(EventTable.seq, segment.through),
          after === undefined ? undefined : gt(EventTable.seq, after),
        ),
      )
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie),
  )).flat()
})

const lineage = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  through?: number,
): Effect.fn.Return<ReadonlyArray<{ readonly sessionID: SessionSchema.ID; readonly through?: number }>> {
  const session = yield* db
    .select({ parentID: SessionTable.fork_session_id, forkSeq: SessionTable.fork_seq })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  const inherited =
    session?.parentID && session.forkSeq !== null
      ? yield* lineage(
          db,
          session.parentID,
          through === undefined ? session.forkSeq : Math.min(session.forkSeq, through),
        )
      : []
  return [...inherited, { sessionID, ...(through === undefined ? {} : { through }) }]
})

function fold(rows: ReadonlyArray<InstructionEventRow>) {
  return rows.reduce<
    | {
        readonly epochStart: number
        readonly throughSeq: number
        readonly initial: Instructions.Values
        readonly current: Instructions.Values
      }
    | undefined
  >((state, row) => {
    if (row.type === movedEventType || row.type === revertedEventType) return undefined
    if (row.type === compactionEventType)
      return state
        ? { epochStart: row.seq, throughSeq: row.seq, initial: state.current, current: state.current }
        : undefined
    if (row.type !== instructionEventType) return state
    const delta = decodeInstructionsUpdated(row.data).delta
    const current = Instructions.applyHashDelta(state?.current ?? {}, delta)
    return state
      ? { ...state, throughSeq: row.seq, current }
      : { epochStart: row.seq, throughSeq: row.seq, initial: current, current }
  }, undefined)
}
