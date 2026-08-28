import { Database } from "@opencode-ai/core/database/database"
import { Session } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { SessionValidationMiddleware } from "@opencode-ai/protocol/middleware/session-validation"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"

const decodeSessionID = Schema.decodeUnknownEffect(Session.ID)

export const sessionValidationLayer = Layer.effect(
  SessionValidationMiddleware,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return SessionValidationMiddleware.of((effect) => requireSession(database.db).pipe(Effect.andThen(effect)))
  }),
)

// Middleware validates before query decoding, preserving the public session error precedence.
export const requireSession = Effect.fn("HttpApi.requireSession")(function* (db: Database.Interface["db"]) {
  const route = yield* HttpRouter.RouteContext
  const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
    Effect.mapError(() => new InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
  const row = yield* db
    .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* new SessionNotFoundError({ sessionID, message: `Session not found: ${sessionID}` })
  return row
})
