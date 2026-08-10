export * as InstructionState from "./instruction-state"

import { eq, inArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import type { Database } from "../database/database"
import type { Bus } from "../bus"
import { Instructions } from "../instructions/index"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import { InstructionBlobTable, InstructionStateTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export interface Observation extends Instructions.Admission {
  readonly sessionID: SessionSchema.ID
  readonly initial: boolean
  readonly previous: Instructions.Values
  readonly current: Instructions.Values
}

export const observe = Effect.fn("InstructionState.observe")(function* (
  db: DatabaseService,
  instructions: Instructions.List,
  sessionID: SessionSchema.ID,
): Effect.fn.Return<Observation, Instructions.InitializationBlocked> {
  const [observed, stored] = yield* Effect.all([Instructions.read(instructions), find(db, sessionID)], {
    concurrency: "unbounded",
  })
  const result = yield* observeAgainst(observed, stored?.current_values)
  return {
    sessionID,
    initial: !stored,
    previous: stored?.current_values ?? {},
    ...result,
  }
})

export const commit = Effect.fn("InstructionState.commit")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  instructions: Instructions.List,
  observation: Observation,
) {
  if (!observation.initial && Object.keys(observation.delta).length === 0) return
  // The rendered text is frozen into the durable event: replaying it later would
  // require the Location-scoped registry that produced it.
  const text = observation.initial ? "" : yield* renderUpdateText(db, instructions, observation)
  yield* bus.publish(
    SessionEvent.InstructionsUpdated,
    {
      sessionID: observation.sessionID,
      delta: observation.delta,
      ...(text.length > 0 ? { text } : {}),
    },
    {
      // Initial sync establishes the baseline; unlike later deltas it is not chronological history.
      ...(observation.initial ? { metadata: { instructions: { initial: true } } } : {}),
      commit: () => insertBlobs(db, observation.blobs),
    },
  )
})

const renderUpdateText = Effect.fnUntraced(function* (
  db: DatabaseService,
  instructions: Instructions.List,
  observation: Observation,
) {
  const replaced = Object.entries(observation.previous).filter(([key]) => Object.hasOwn(observation.delta, key))
  const blobs = yield* loadBlobs(
    db,
    replaced.map(([, hash]) => hash),
  )
  const previous = Object.fromEntries(replaced.map(([key, hash]) => [key, requireBlob(blobs, hash)]))
  const admitted = new Map(
    Object.entries(observation.blobs).map(([hash, value]) => [Instructions.Hash.make(hash), value]),
  )
  return Instructions.renderUpdate(instructions, previous, dereferenceDelta(observation.delta, admitted))
})

export const prepare = Effect.fn("InstructionState.prepare")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  instructions: Instructions.List,
  sessionID: SessionSchema.ID,
) {
  yield* commit(db, bus, instructions, yield* observe(db, instructions, sessionID))
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

export const initialize = Effect.fn("InstructionState.initialize")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  seq: number,
  values: Instructions.Values,
) {
  yield* db
    .insert(InstructionStateTable)
    .values({
      session_id: sessionID,
      epoch_start: seq,
      through_seq: seq,
      initial_values: values,
      current_values: values,
    })
    .onConflictDoNothing()
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

/** Renders the epoch baseline shown at the start of every model request. */
export const initial = Effect.fn("InstructionState.initial")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
) {
  const state = yield* find(db, sessionID)
  if (!state) return yield* Effect.die(new Error(`Instruction state not found during assembly: ${sessionID}`))
  const blobs = yield* loadBlobs(db, Object.values(state.initial_values))
  return Instructions.renderInitial(instructions, dereference(state.initial_values, blobs))
})

/** The current instruction values, used to seed a fork's baseline. */
export const current = Effect.fn("InstructionState.current")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  return (yield* find(db, sessionID))?.current_values
})

export const preview = Effect.fn("InstructionState.preview")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
  observed: Instructions.ReadResult,
) {
  const state = yield* find(db, sessionID)
  const result = yield* observeAgainst(observed, state?.current_values)
  const observedBlobs = new Map<Instructions.Hash, Schema.Json>(
    Object.entries(result.blobs).map(([hash, value]) => [Instructions.Hash.make(hash), value]),
  )
  if (!state) {
    const values = dereference(result.current, observedBlobs)
    return { initial: Instructions.renderInitial(instructions, values), update: "" }
  }
  const stored = yield* loadBlobs(db, [...Object.values(state.initial_values), ...Object.values(state.current_values)])
  return {
    initial: Instructions.renderInitial(instructions, dereference(state.initial_values, stored)),
    update: Instructions.renderUpdate(
      instructions,
      dereference(state.current_values, stored),
      dereferenceDelta(result.delta, new Map([...stored, ...observedBlobs])),
    ),
  }
})

const observeAgainst = Effect.fnUntraced(function* (observed: Instructions.ReadResult, previous?: Instructions.Values) {
  const admission = yield* Instructions.diff(observed, previous)
  return {
    current: Instructions.applyHashDelta(previous ?? {}, admission.delta),
    ...admission,
  }
})

const find = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
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
