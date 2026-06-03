export * as SessionStore from "./store"

import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionContext } from "./context"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { fromRow } from "./info"

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info | undefined>
  readonly context: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: SessionSchema.ID; readonly message: SessionMessage.Message } | undefined>
  /** Reads the latest durable outer provider-attempt settlement. */
  readonly attemptState: (sessionID: SessionSchema.ID) => Effect.Effect<{
    readonly unsettled: boolean
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      context: Effect.fn("SessionStore.context")(function* (sessionID) {
        return yield* SessionContext.load(db, sessionID)
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
              sessionID: SessionSchema.ID.make(row.session_id),
              message: yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
            }
          : undefined
      }),
      attemptState: Effect.fn("SessionStore.attemptState")(function* (sessionID) {
        const latest = (type: string) =>
          db
            .select({ id: EventTable.id, seq: EventTable.seq, data: EventTable.data })
            .from(EventTable)
            .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, type)))
            .orderBy(desc(EventTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
        const started = yield* latest(
          EventV2.versionedType(SessionEvent.Turn.Started.type, SessionEvent.Turn.Started.sync!.version),
        )
        const settled = yield* latest(
          EventV2.versionedType(SessionEvent.Turn.Settled.type, SessionEvent.Turn.Settled.sync!.version),
        )
        const decodedSettled =
          settled === undefined
            ? undefined
            : yield* Schema.decodeUnknownEffect(SessionEvent.Turn.Settled.data)(settled.data).pipe(Effect.orDie)
        return {
          unsettled: started !== undefined && decodedSettled?.turnID !== started.id,
        }
      }),
    })
  }),
)
