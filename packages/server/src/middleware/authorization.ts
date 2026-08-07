import { ServerAuth } from "../auth"
import { UserContext } from "@opencode-ai/schema/user-context"
import { UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { Effect, Encoding, Layer, Option, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function extractBearerToken(request: HttpServerRequest.HttpServerRequest): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")
  return match?.[1]
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const jwtSecret = yield* ServerAuth.JwtConfig

    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        // Browsers cannot set headers on WebSocket upgrades, so a ticketed PTY connect skips
        // credential checks here; the connect handler consumes and validates the ticket.
        if (hasPtyConnectTicketURL(new URL(request.url, "http://localhost"))) return yield* effect

        // Attempt JWT Bearer token first
        const bearerToken = extractBearerToken(request)
        if (bearerToken) {
          if (!jwtSecret) {
            // JWT secret not configured, skip JWT validation
            // Fall through to checking credentials below
          } else {
            const userContext = yield* ServerAuth.validateJwt(bearerToken)
            if (Option.isSome(userContext)) {
              // Inject UserContext into the effect context
              return yield* effect.pipe(Effect.provideService(UserContext.Service, userContext.value))
            }
            // JWT present but invalid — do NOT fall back to Basic Auth
            yield* HttpEffect.appendPreResponseHandler((_request, response) =>
              Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
            )
            return yield* new UnauthorizedError({ message: "Invalid or expired JWT" })
          }
        }

        // Fall back to Basic Auth
        if (!ServerAuth.required(config)) return yield* effect
        const credential = yield* credentialFromRequest(request)
        if (ServerAuth.authorized(credential, config)) return yield* effect
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)
