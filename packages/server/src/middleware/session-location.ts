import { Instance } from "@Mackery6969/core/instance/service"
import { Session } from "@Mackery6969/core/session"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { LocationNotFoundError, InvalidRequestError, SessionNotFoundError } from "@Mackery6969/protocol/errors"
import { locationErrors, sessionInfo, type LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@Mackery6969/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError, LocationNotFoundError],
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
