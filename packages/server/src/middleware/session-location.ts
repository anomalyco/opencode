import { Database } from "@bolt-ai/core/database/database"
import { LocationServiceMap } from "@bolt-ai/core/location-services"
import { Location } from "@bolt-ai/core/location"
import { AbsolutePath } from "@bolt-ai/core/schema"
import { SessionV2 } from "@bolt-ai/core/session"
import { SessionTable } from "@bolt-ai/core/session/sql"
import { WorkspaceV2 } from "@bolt-ai/core/workspace"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@bolt-ai/protocol/errors"
import type { LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@bolt/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const session = yield* sessionInfo(sessions, route.params.sessionID)
        return yield* effect.pipe(instances.provide(session), locationErrors)
      }),
    )
  }),
)
