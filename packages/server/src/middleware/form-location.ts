import { Instance } from "@opencode-ai/core/instance/service"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Session } from "@opencode-ai/core/session"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { requestRef, sessionInfo, type LocationServices } from "../location"

export class FormLocationMiddleware extends HttpApiMiddleware.Service<
  FormLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiFormLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

export const formLocationLayer = Layer.effect(
  FormLocationMiddleware,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const locations = yield* LocationServiceMap.Service

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

        const session = yield* sessionInfo(sessions, route.params.sessionID)
        return yield* effect.pipe(instances.provide(session))
      }),
    )
  }),
)
