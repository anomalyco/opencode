import { ServerAuth } from "@/server/auth"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"

const AUTH_TOKEN_QUERY = "auth_token"
const UNAUTHORIZED = 401
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
    security: {
      basic: HttpApiSecurity.basic,
      authToken: HttpApiSecurity.apiKey({ in: "query", key: AUTH_TOKEN_QUERY }),
    },
  },
) {}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  return Effect.gen(function* () {
    if (!ServerAuth.required(config)) return yield* effect
    if (!ServerAuth.authorized(credential, config)) return yield* new HttpApiError.Unauthorized({})
    return yield* effect
  })
}

function decodeCredential(input: string) {
  const emptyCredential = {
    username: "",
    password: Redacted.make(""),
  }

  return Encoding.decodeBase64String(input)
    .asEffect()
    .pipe(
      Effect.match({
        onFailure: () => emptyCredential,
        onSuccess: (header) => {
          const parts = header.split(":")
          if (parts.length !== 2) return emptyCredential
          return {
            username: parts[0],
            password: Redacted.make(parts[1]),
          }
        },
      }),
    )
}

function validateRawCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  if (!ServerAuth.required(config)) return effect
  if (!ServerAuth.authorized(credential, config))
    return Effect.succeed(
      HttpServerResponse.empty({
        status: UNAUTHORIZED,
        headers: { "www-authenticate": WWW_AUTHENTICATE },
      }),
    )
  return effect
}

export const authorizationRouterMiddleware = HttpRouter.middleware()(
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return (effect) => effect

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
        if (match) {
          return yield* decodeCredential(match[1]).pipe(
            Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
          )
        }

        const token = new URL(request.url, "http://localhost").searchParams.get(AUTH_TOKEN_QUERY)
        if (token) {
          return yield* decodeCredential(token).pipe(
            Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
          )
        }

        return yield* validateRawCredential(effect, { username: "", password: Redacted.make("") }, config)
      })
  }),
)

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    return Authorization.of({
      basic: (effect, { credential }) => validateCredential(effect, credential, config),
      authToken: (effect, { credential }) =>
        decodeCredential(Redacted.value(credential)).pipe(
          Effect.flatMap((decoded) => validateCredential(effect, decoded, config)),
        ),
    })
  }),
)
