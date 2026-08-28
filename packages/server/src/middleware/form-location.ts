import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { requestRef, sessionRef, type LocationServices } from "../location"

export class FormLocationMiddleware extends HttpApiMiddleware.Service<
  FormLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiFormLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

export const formLocationLayer = Layer.effect(
  FormLocationMiddleware,
  Effect.gen(function* () {
    const database = yield* Database.Service
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

        const ref = yield* sessionRef(database, route.params.sessionID)
        return yield* effect.pipe(Effect.provide(locations.get(ref)))
      }),
    )
  }),
)
