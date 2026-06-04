import { and, asc, desc, eq, gt, gte, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

export const load = Effect.fn("SessionContext.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const compaction = yield* db
    .select()
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction ? or(gte(SessionMessageTable.seq, compaction.seq)) : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return yield* Effect.forEach(rows, (row) =>
    decode({ ...row.data, id: row.id, type: row.type }).pipe(
      Effect.mapError(
        () =>
          new MessageDecodeError({
            sessionID: SessionSchema.ID.make(row.session_id),
            messageID: SessionMessage.ID.make(row.id),
          }),
      ),
    ),
  )
})

export * as SessionContext from "./context"
