import { Instance } from "@opencode-ai/core/instance/service"
import { Session } from "@opencode-ai/core/session"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { sessionInfo, type LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiSessionLocation", {
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
        return yield* effect.pipe(instances.provide(session))
      }),
    )
  }),
)
