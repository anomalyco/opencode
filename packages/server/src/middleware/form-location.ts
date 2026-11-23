import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Session } from "@opencode/core/session"
import { LocationNotFoundError, InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { locationErrors, requestRef, sessionInfo, type LocationServices } from "../location"

export class FormLocationMiddleware extends HttpApiMiddleware.Service<
  FormLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiFormLocation", {
  error: [InvalidRequestError, SessionNotFoundError, LocationNotFoundError],
}) {}

export const formLocationLayer = Layer.effect(
  FormLocationMiddleware,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const locations = yield* LocationServiceMap.Service

    return FormLocationMiddleware.of((effect, options) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        if (route.params.sessionID === "global") {
          // Temporary MCP elicitation escape hatch. This is still Location-scoped; it only bypasses
          // the session row lookup because some MCP elicitations cannot currently be attributed to
          // a real session. Keep this undocumented and remove once elicitations carry session ownership.
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* effect.pipe(Effect.provide(locations.get(requestRef(request))), locationErrors)
        }

        const session = yield* sessionInfo(sessions, route.params.sessionID)
        // Forms live in memory, so a Session without live capabilities has none pending. Listing must
        // not boot its Location: clients poll whole subagent trees, including deleted worktrees.
        if (options.endpoint.identifier === "session.form.list" && instances.live && !(yield* instances.live(session)))
          return HttpServerResponse.jsonUnsafe({ data: [] })
        return yield* effect.pipe(instances.provide(session), locationErrors)
      }),
    )
  }),
)
