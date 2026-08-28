import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { Effect, Layer } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import type { LocationServices } from "../location"
import { requireSession } from "./session-validation"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const row = yield* requireSession(db)

        return yield* effect.pipe(
          Effect.provide(
            locations.get(
              Location.Ref.make({
                directory: AbsolutePath.make(row.directory),
                workspaceID: row.workspaceID ? Workspace.ID.make(row.workspaceID) : undefined,
              }),
            ),
          ),
        )
      }),
    )
  }),
)
