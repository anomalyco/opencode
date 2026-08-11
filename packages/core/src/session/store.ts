export * as SessionStore from "./store"

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { SessionHistory } from "./history"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessageTable, SessionTable } from "./sql"
import { fromRow } from "./info"

export interface Interface {
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Info | undefined>
  readonly context: (sessionID: Session.ID) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.Info } | undefined>
  readonly listSuspended: () => Effect.Effect<ReadonlyArray<Session.ID>>
  /** Clears the claim, reporting whether this caller consumed it. At most one concurrent caller receives true. */
  readonly consumeSuspended: (sessionID: Session.ID) => Effect.Effect<boolean>
  /**
   * Records the execution claim: the durable write-ahead intent that a turn is
   * (or was) in flight. Set when execution starts; a claim that survives to the
   * next boot is the signature of a process that died without teardown.
   */
  readonly claim: (sessionID: Session.ID) => Effect.Effect<void>
  /** Releases the claim and resets resume accounting. Terminal events call this on commit. */
  readonly release: (sessionID: Session.ID) => Effect.Effect<void>
  /** Durably counts one more resume of an orphaned claim, returning the new total. */
  readonly countResume: (sessionID: Session.ID) => Effect.Effect<number>
  /**
   * When the Session's messages last changed, or undefined for an empty
   * Session. Message rows update as a live drain streams, so recent activity
   * suggests another process may still own the turn. Event persistence is
   * opt-in, so this deliberately reads messages, not the event log.
   */
  readonly lastActivityAt: (sessionID: Session.ID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Info)

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      context: Effect.fn("SessionStore.context")(function* (sessionID) {
        return yield* SessionHistory.load(db, sessionID)
      }),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: Session.ID.make(row.session_id),
              message: yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
            }
          : undefined
      }),
      listSuspended: Effect.fn("SessionStore.listSuspended")(function* () {
        return yield* db
          .select({ sessionID: SessionTable.id })
          .from(SessionTable)
          .where(isNotNull(SessionTable.time_suspended))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => row.sessionID)),
          )
      }),
      consumeSuspended: Effect.fn("SessionStore.consumeSuspended")(function* (sessionID) {
        return (
          (yield* db
            .update(SessionTable)
            .set({ time_suspended: null })
            .where(and(eq(SessionTable.id, sessionID), isNotNull(SessionTable.time_suspended)))
            .returning({ sessionID: SessionTable.id })
            .get()
            .pipe(Effect.orDie)) !== undefined
        )
      }),
      claim: Effect.fn("SessionStore.claim")(function* (sessionID) {
        // The null guard preserves the original claim time if a claimed Session drains again
        // before the sweep saw it (a user prompt beat the recovery to the wake-up).
        yield* db
          .update(SessionTable)
          .set({ time_suspended: Date.now() })
          .where(and(eq(SessionTable.id, sessionID), isNull(SessionTable.time_suspended)))
          .run()
          .pipe(Effect.orDie)
      }),
      release: Effect.fn("SessionStore.release")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_suspended: null, resume_attempts: 0 })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
      countResume: Effect.fn("SessionStore.countResume")(function* (sessionID) {
        const row = yield* db
          .update(SessionTable)
          .set({ resume_attempts: sql`${SessionTable.resume_attempts} + 1` })
          .where(eq(SessionTable.id, sessionID))
          .returning({ attempts: SessionTable.resume_attempts })
          .get()
          .pipe(Effect.orDie)
        return row?.attempts ?? 0
      }),
      lastActivityAt: Effect.fn("SessionStore.lastActivityAt")(function* (sessionID) {
        const row = yield* db
          .select({ updatedAt: sql<number | null>`max(${SessionMessageTable.time_updated})` })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row?.updatedAt ?? undefined
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
