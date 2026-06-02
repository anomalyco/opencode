import { and, asc, desc, eq, gt, gte, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
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
    .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gt(SessionMessageTable.time_created, compaction.time_created),
              and(eq(SessionMessageTable.time_created, compaction.time_created), gte(SessionMessageTable.id, compaction.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
    .all()
    .pipe(Effect.orDie)
  return yield* Effect.forEach(rows, (row) => decode({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie))
})

export * as SessionContext from "./context"
