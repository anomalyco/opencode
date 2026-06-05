export * as SessionContextEpoch from "./context-epoch"

import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { Location } from "../location"
import { SystemContext } from "../system-context"
import { SystemContextRegistry } from "../system-context-registry"
import { SessionEvent } from "./event"
import { SessionInput } from "./input"
import { SessionMessageID } from "./message-id"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionTable } from "./sql"

type DatabaseService = Database.Interface["db"]

class RevisionMismatch extends Error {}
class LocationMismatch extends Error {}

const retryRevisionMismatch = <A, E>(attempt: () => Effect.Effect<A, E>): Effect.Effect<A, E> =>
  attempt().pipe(
    Effect.catchDefect((defect) =>
      defect instanceof RevisionMismatch
        ? Effect.yieldNow.pipe(Effect.andThen(retryRevisionMismatch(attempt)))
        : Effect.die(defect),
    ),
  )

interface Prepared {
  readonly baseline: string
  readonly baselineSeq: number
}

export function initialize(
  db: DatabaseService,
  context: SystemContextRegistry.Interface,
  sessionID: SessionSchema.ID,
  location: Location.Ref,
): Effect.Effect<Prepared | undefined, SystemContext.InitializationBlocked> {
  return retryRevisionMismatch(() => initializeOnce(db, context, sessionID, location)).pipe(
    Effect.withSpan("SessionContextEpoch.initialize"),
  )
}

export function prepare(
  db: DatabaseService,
  events: EventV2.Interface,
  context: SystemContextRegistry.Interface,
  sessionID: SessionSchema.ID,
  location: Location.Ref,
): Effect.Effect<Prepared, SystemContext.InitializationBlocked> {
  return retryRevisionMismatch(() => prepareOnce(db, events, context, sessionID, location)).pipe(
    Effect.withSpan("SessionContextEpoch.prepare"),
  )
}

const prepareOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  context: SystemContextRegistry.Interface,
  sessionID: SessionSchema.ID,
  location: Location.Ref,
) {
  const [value, stored] = yield* Effect.all([context.load(), find(db, sessionID)], { concurrency: "unbounded" })
  if (!stored) {
    const generation = yield* SystemContext.initialize(value)
    const baselineSeq = yield* insert(db, sessionID, location, generation)
    return { baseline: generation.baseline, baselineSeq }
  }

  const snapshot = yield* Schema.decodeUnknownEffect(SystemContext.Snapshot)(stored.snapshot).pipe(Effect.orDie)
  const result =
    stored.replacement_seq === null
      ? yield* SystemContext.reconcile(value, snapshot)
      : yield* SystemContext.replace(value, snapshot)
  if (result._tag === "Unchanged" || result._tag === "ReplacementBlocked")
    return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
  if (result._tag === "ReplacementReady") {
    const replacementSeq = stored.replacement_seq ?? (yield* SessionInput.latestSeq(db, sessionID))
    yield* replace(db, sessionID, stored.revision, replacementSeq, result.generation)
    return { baseline: result.generation.baseline, baselineSeq: replacementSeq }
  }

  yield* events.publish(
    SessionEvent.ContextUpdated,
    { sessionID, messageID: SessionMessageID.ID.create(), timestamp: yield* DateTime.now, text: result.text },
    { commit: () => advance(db, sessionID, stored.revision, result.snapshot).pipe(Effect.orDie) },
  )
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

const initializeOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  context: SystemContextRegistry.Interface,
  sessionID: SessionSchema.ID,
  location: Location.Ref,
) {
  if (yield* exists(db, sessionID)) return
  const generation = yield* context.load().pipe(Effect.flatMap(SystemContext.initialize))
  const baselineSeq = yield* insert(db, sessionID, location, generation)
  return { baseline: generation.baseline, baselineSeq }
})

const exists = Effect.fn("SessionContextEpoch.exists")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return (
    (yield* db
      .select({ sessionID: SessionContextEpochTable.session_id })
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

const find = Effect.fn("SessionContextEpoch.find")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionContextEpochTable)
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

export const requestReplacement = Effect.fn("SessionContextEpoch.requestReplacement")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  seq: number,
) {
  return yield* db
    .update(SessionContextEpochTable)
    .set({ replacement_seq: seq, revision: sql`${SessionContextEpochTable.revision} + 1` })
    .where(
      and(
        eq(SessionContextEpochTable.session_id, sessionID),
        lt(SessionContextEpochTable.baseline_seq, seq),
        or(isNull(SessionContextEpochTable.replacement_seq), lt(SessionContextEpochTable.replacement_seq, seq)),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const reset = Effect.fn("SessionContextEpoch.reset")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  yield* db.delete(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, sessionID)).run().pipe(Effect.orDie)
})

const insert = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  location: Location.Ref,
  generation: SystemContext.Generation,
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const placed = yield* db
            .select({ sessionID: SessionTable.id })
            .from(SessionTable)
            .where(
              and(
                eq(SessionTable.id, sessionID),
                eq(SessionTable.directory, location.directory),
                location.workspaceID === undefined
                  ? isNull(SessionTable.workspace_id)
                  : eq(SessionTable.workspace_id, location.workspaceID),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!placed) return yield* Effect.die(new LocationMismatch())
          const baselineSeq = yield* SessionInput.latestSeq(db, sessionID)
          yield* db
            .insert(SessionContextEpochTable)
            .values({
              session_id: sessionID,
              baseline: generation.baseline,
              snapshot: generation.snapshot,
              baseline_seq: baselineSeq,
              revision: 0,
            })
            .onConflictDoNothing()
            .returning({ sessionID: SessionContextEpochTable.session_id })
            .get()
            .pipe(
              Effect.orDie,
              Effect.flatMap((inserted) => (inserted ? Effect.void : Effect.die(new RevisionMismatch()))),
            )
          return baselineSeq
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
})

const replace = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  expectedRevision: number,
  baselineSeq: number,
  generation: SystemContext.Generation,
) {
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({
      baseline: generation.baseline,
      snapshot: generation.snapshot,
      baseline_seq: baselineSeq,
      replacement_seq: null,
      revision: expectedRevision + 1,
    })
    .where(
      and(eq(SessionContextEpochTable.session_id, sessionID), eq(SessionContextEpochTable.revision, expectedRevision)),
    )
    .returning({ revision: SessionContextEpochTable.revision })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(new RevisionMismatch())
})

const advance = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  expectedRevision: number,
  snapshot: SystemContext.Snapshot,
) {
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({ snapshot, revision: expectedRevision + 1 })
    .where(
      and(
        eq(SessionContextEpochTable.session_id, sessionID),
        eq(SessionContextEpochTable.revision, expectedRevision),
        isNull(SessionContextEpochTable.replacement_seq),
      ),
    )
    .returning({ revision: SessionContextEpochTable.revision })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(new RevisionMismatch())
})
