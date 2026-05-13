import { ServerAuth } from "@/server/auth"
import { Effect, Layer, Redacted } from "effect"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware } from "effect/unstable/httpapi"
import { hasPtyConnectTicketURL } from "@/server/shared/pty-ticket"
import { isPublicUIPath } from "@/server/shared/public-ui"

const AUTH_TOKEN_QUERY = "auth_token"
const UNAUTHORIZED = 401
const BASIC_WWW_AUTHENTICATE = 'Basic realm="Secure Area"'
const BEARER_WWW_AUTHENTICATE = "Bearer"

// Avoid HttpApiSecurity alternatives here: Effect security middleware wraps the
// full handler, so a downstream failure can make the next auth alternative run
// and remap an authorized NotFound into Unauthorized.
export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

function emptyCredential() {
  return {
    username: "",
    password: Redacted.make(""),
  }
}

function wwwAuthenticate(config: ServerAuth.Info) {
  return config.mode === "oidc" ? BEARER_WWW_AUTHENTICATE : BASIC_WWW_AUTHENTICATE
}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  return Effect.gen(function* () {
    if (!ServerAuth.required(config)) return yield* effect
    if (config.mode !== "basic") return yield* effect
    if (!ServerAuth.authorized(credential, config)) {
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", wwwAuthenticate(config))),
      )
      return yield* new HttpApiError.Unauthorized({})
    }
    return yield* effect
  })
}

function decodeCredential(input: string) {
  return Effect.succeed(ServerAuth.decodeBasic(input) ?? emptyCredential())
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  return credentialFromURL(new URL(request.url, "http://localhost"), request)
}

function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest) {
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function validateRawCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  if (!ServerAuth.required(config)) return effect
  if (config.mode === "oidc") {
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://localhost")
      return yield* Effect.tryPromise(() =>
        ServerAuth.verifyRequest(config, ServerAuth.requestFromEffect(request)),
      ).pipe(
        Effect.flatMap(() => effect),
        Effect.catch(() => {
          if (ServerAuth.wantsHtml(request)) {
            const login = new URL("/auth/login", url.origin)
            login.searchParams.set("return_to", url.pathname + url.search)
            return Effect.succeed(HttpServerResponse.empty({ status: 302, headers: { location: login.toString() } }))
          }
          return Effect.succeed(
            HttpServerResponse.empty({
              status: UNAUTHORIZED,
              headers: { "www-authenticate": wwwAuthenticate(config) },
            }),
          )
        }),
      )
    })
  }
  if (!ServerAuth.authorized(credential, config))
    return Effect.succeed(
      HttpServerResponse.empty({
        status: UNAUTHORIZED,
        headers: { "www-authenticate": wwwAuthenticate(config) },
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
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect
        if (hasPtyConnectTicketURL(url)) return yield* effect
        return yield* credentialFromURL(url, request).pipe(
          Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
        )
      })
  }),
)

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
    if (config.mode === "oidc") {
      return Authorization.of((effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* Effect.tryPromise(() =>
            ServerAuth.verifyRequest(config, ServerAuth.requestFromEffect(request)),
          ).pipe(
            Effect.flatMap(() => effect),
            Effect.catch(() =>
              Effect.gen(function* () {
                yield* HttpEffect.appendPreResponseHandler((_request, response) =>
                  Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", wwwAuthenticate(config))),
                )
                return yield* new HttpApiError.Unauthorized({})
              }),
            ),
          )
        }),
      )
    }
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* credentialFromRequest(request).pipe(
          Effect.flatMap((credential) => validateCredential(effect, credential, config)),
        )
      }),
    )
  }),
)
