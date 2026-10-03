import { RemoteAccess } from "@/remote/access"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware } from "effect/unstable/httpapi"

export class RemoteAuthorization extends HttpApiMiddleware.Service<RemoteAuthorization>()(
  "@opencode/ExperimentalHttpApiRemoteAuthorization",
  { error: HttpApiError.UnauthorizedNoContent },
) {}

function bearer(request: HttpServerRequest.HttpServerRequest) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")
  return match?.[1]
}

function sessionID(request: HttpServerRequest.HttpServerRequest) {
  return new URL(request.url, "http://localhost").pathname.match(/^\/remote\/session\/([^/]+)(?:\/|$)/)?.[1]
}

export const remoteAuthorizationLayer = Layer.effect(
  RemoteAuthorization,
  Effect.succeed(
    RemoteAuthorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = bearer(request)
        const session = sessionID(request)
        if (!token || !session || !RemoteAccess.authorized(token, session)) {
          return yield* new HttpApiError.Unauthorized({})
        }
        return yield* effect
      }),
    ),
  ),
)
