import { ServerAuth } from "@/server/auth"
import { Effect, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors"

// VSCode's "Bring your own key" custom endpoint authenticates with
// `Authorization: Bearer <key>`. The default server Authorization middleware
// only understands HTTP Basic / `?auth_token=`, so the gateway group uses this
// Bearer-aware variant: the bearer token is treated as the server password
// (username defaults to OPENCODE_SERVER_USERNAME). When no password is
// configured the server is unsecured and every request passes through, exactly
// like the rest of the API.
export class GatewayAuthorization extends HttpApiMiddleware.Service<GatewayAuthorization>()(
  "@opencode/GatewayHttpApiAuthorization",
  {
    error: UnauthorizedError,
  },
) {}

function bearerCredential(
  request: HttpServerRequest.HttpServerRequest,
  config: ServerAuth.Info,
): ServerAuth.DecodedCredentials | undefined {
  const header = request.headers.authorization ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return undefined
  return { username: config.username, password: Redacted.make(match[1].trim()) }
}

export const gatewayAuthorizationLayer = Layer.effect(
  GatewayAuthorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return GatewayAuthorization.of((effect) => effect)
    return GatewayAuthorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const credential = bearerCredential(request, config)
        if (credential && ServerAuth.authorized(credential, config)) return yield* effect
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"'),
          ),
        )
        return yield* new UnauthorizedError({ message: "Invalid API key" })
      }),
    )
  }),
)
