import { ServerAuth } from "../auth"
import { RequestIdentity } from "../request-identity"
import { UnauthorizedError } from "@opencode/protocol/errors"
import { Authorization } from "@opencode/protocol/middleware/authorization"
export { Authorization } from "@opencode/protocol/middleware/authorization"
import { ServerIdentity } from "@opencode/core/server-identity"
import { PTY_CONNECT_PATH, PTY_CONNECT_TICKET_QUERY } from "@opencode/protocol/groups/pty"
import { PERSISTENT_PTY_CONNECT_PATH } from "@opencode/protocol/groups/persistent-pty"
import { MCP_CLIENT_PATH } from "@opencode/protocol/groups/mcp"
import { PAIRING_CONNECT_PATH } from "@opencode/protocol/groups/server"
import { AUTH_LOGIN_PATH, AUTH_REGISTER_PATH } from "@opencode/protocol/groups/auth"
import { Effect, Layer, Option, Redacted } from "effect"
import { Base64 } from "effect/encoding"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Base64.decodeString(input)).pipe(
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

const UNAUTHORIZED_MESSAGE = "Authentication required"

// Browsers show a native credentials prompt for a Basic challenge even on fetch, which would stall the web app
// before it can show its own sign-in screen. Only non-browser clients and page navigations get the challenge.
function challengeRequest(request: HttpServerRequest.HttpServerRequest) {
  const mode = request.headers["sec-fetch-mode"]
  return mode === undefined || mode === "navigate"
}

// Matches what the Authorization middleware encodes, for requests rejected before the HttpApi runs.
export function unauthorizedResponse(
  request: HttpServerRequest.HttpServerRequest,
  methods: ReadonlyArray<"password" | "local"> = [],
) {
  return HttpServerResponse.jsonUnsafe(
    { _tag: "UnauthorizedError", message: UNAUTHORIZED_MESSAGE, methods: [...methods] },
    { status: 401, headers: challengeRequest(request) ? { "www-authenticate": WWW_AUTHENTICATE } : undefined },
  )
}

// Same-site pages on other ports still send this cookie, so only same-origin requests may use it.
function sessionCookieToken(request: HttpServerRequest.HttpServerRequest) {
  const token = request.cookies[ServerAuth.sessionCookieName(request.headers.host)]
  if (!token) return
  const origin = request.headers.origin
  if (origin !== undefined && URL.parse(origin)?.host !== request.headers.host) return
  return token
}

const denied = (request: HttpServerRequest.HttpServerRequest, methods: ReadonlyArray<"password" | "local">) =>
  Effect.gen(function* () {
    if (challengeRequest(request))
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
      )
    return yield* new UnauthorizedError({
      message: UNAUTHORIZED_MESSAGE,
      methods: [...methods],
    })
  })

function authorizedSessionCookie(request: HttpServerRequest.HttpServerRequest, config: ServerAuth.Info) {
  const token = sessionCookieToken(request)
  return token !== undefined && ServerAuth.verifySession(token, config)
}

/** Whether the request carries the shared password or its cookie: the only credential outside local accounts. */
export function authorizedRequest(request: HttpServerRequest.HttpServerRequest, config: ServerAuth.Info) {
  return credentialFromRequest(request).pipe(
    Effect.flatMap((credential) =>
      Effect.succeed(ServerAuth.authorized(credential, config) || authorizedSessionCookie(request, config)),
    ),
  )
}

/** The database session verified by the request's Basic password or session cookie, or undefined when neither works. */
function verifiedIdentityRequest(
  request: HttpServerRequest.HttpServerRequest,
  identity: ServerIdentity.Interface,
): Effect.Effect<ServerIdentity.Verified | undefined> {
  return credentialFromRequest(request).pipe(
    Effect.flatMap((credential) => {
      const token = Redacted.value(credential.password)
      const cookieToken = sessionCookieToken(request)
      if (token === "" && cookieToken === undefined) return Effect.succeed(undefined)
      return Effect.gen(function* () {
        const verified = token === "" ? undefined : yield* identity.verify(token)
        if (verified !== undefined) return verified
        return cookieToken !== undefined ? yield* identity.verify(cookieToken) : undefined
      })
    }),
  )
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
    const methods = config.local ? (["local"] as const) : (["password"] as const)
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const route = yield* HttpRouter.RouteContext
        // Local accounts verify tokens against the database, so the identity service is only there in
        // local mode; serviceOption keeps the check buildable without it.
        const identity = config.local
          ? Option.getOrUndefined(yield* Effect.serviceOption(ServerIdentity.Service))
          : undefined
        // Ticketed PTY and client MCP connects (browsers cannot set headers on WebSocket upgrades), pairing
        // links, and local sign-in skip credential checks here; their handlers consume and validate the
        // ticket, code, or credentials. Use the route selected by Effect so authorization and dispatch cannot
        // disagree about the request path.
        const url = new URL(request.url, "http://localhost")
        if (
          ((route.route.path === PTY_CONNECT_PATH ||
            route.route.path === PERSISTENT_PTY_CONNECT_PATH ||
            route.route.path === MCP_CLIENT_PATH) &&
            !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)) ||
          route.route.path === PAIRING_CONNECT_PATH ||
          route.route.path === AUTH_REGISTER_PATH ||
          route.route.path === AUTH_LOGIN_PATH
        )
          return yield* effect
        if (identity !== undefined) {
          // Local accounts authorize only with database sessions; the shared password grants nothing. The
          // token rides the Basic password field (query tokens decode into it too) or the session cookie.
          // Verification happens once here so handlers see the account the request belongs to.
          const verified = yield* verifiedIdentityRequest(request, identity)
          if (verified === undefined) return yield* denied(request, methods)
          return yield* Effect.provideService(effect, RequestIdentity, verified)
        }
        if (yield* authorizedRequest(request, config)) return yield* effect
        return yield* denied(request, methods)
      }),
    )
  }),
)
