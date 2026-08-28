import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { InstanceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Workspace } from "@opencode-ai/core/workspace"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { requestRef, type LocationServices } from "../location"

export class FormLocationMiddleware extends HttpApiMiddleware.Service<
  FormLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiFormLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

const decodeSessionID = Schema.decodeUnknownEffect(Session.ID)

export const formLocationLayer = Layer.effect(
  FormLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* InstanceMap.Service

    return FormLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        if (route.params.sessionID === "global") {
          // Temporary MCP elicitation escape hatch. This is still Location-scoped; it only bypasses
          // the session row lookup because some MCP elicitations cannot currently be attributed to
          // a real session. Keep this undocumented and remove once elicitations carry session ownership.
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* effect.pipe(Effect.provide(locations.get(requestRef(request))))
        }

        const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
          Effect.mapError(
            () =>
              new InvalidRequestError({
                message: "Invalid session ID",
                field: "sessionID",
              }),
          ),
        )
        const row = yield* db
          .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) {
          return yield* new SessionNotFoundError({
            sessionID,
            message: `Session not found: ${sessionID}`,
          })
        }

        return yield* effect.pipe(
          Effect.provide(
            locations.forSession({
              location: Location.Ref.make({
                directory: AbsolutePath.make(row.directory),
                workspaceID: row.workspaceID ? Workspace.ID.make(row.workspaceID) : undefined,
              }),
            }),
          ),
        )
      }),
    )
  }),
)
