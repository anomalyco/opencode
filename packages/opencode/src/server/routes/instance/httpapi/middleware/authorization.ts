import { ServerAuth } from "@/server/auth"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware } from "effect/unstable/httpapi"
import { hasPtyConnectTicketURL } from "@/server/shared/pty-ticket"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { authMode, cookieAuthorizesRequest } from "@/collab/cookie-auth"

const AUTH_TOKEN_QUERY = "auth_token"
const UNAUTHORIZED = 401
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

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

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  return Effect.gen(function* () {
    if (!ServerAuth.required(config)) return yield* effect
    // Same isPublicUIPath bypass the router middleware honors — needed so
    // the SPA can call /global/health at boot without triggering the
    // browser's native basic-auth dialog.
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (isPublicUIPath(request.method, url.pathname)) return yield* effect

    // Cookie-based auth (the GitHub OAuth path).  See CONTEXT.md →
    // "Cookie Authorization Scope" + ADR-0001.  A valid cookie scoped to
    // the addressed workspace/native session passes the gate without ever
    // touching basic auth — that's why OAuth users don't see the browser's
    // basic-auth dialog from the iframe's API calls.
    const cookieDecision = cookieDecisionFromHttpRequest(request, url)
    if (cookieDecision === "allow") return yield* effect
    if (cookieDecision === "deny") {
      // Cookie was valid but didn't scope to this resource.  Do NOT fall
      // through to basic-auth — that would leak the existence of a server
      // password to an unscoped user.
      return yield* new HttpApiError.Unauthorized({})
    }
    // fallthrough: in collab mode there is no basic-auth fallback —
    // unauthenticated request always fails.  No www-authenticate header =>
    // no browser native dialog.  HttpApi middleware can't easily emit a 302
    // (the contract is fail-with-Unauthorized or return the effect), so the
    // 302-for-HTML redirect lives in the router middleware below.  Here we
    // just deny without leaking the password.
    if (authMode() === "collab") {
      return yield* new HttpApiError.Unauthorized({})
    }

    if (!ServerAuth.authorized(credential, config)) {
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
      )
      return yield* new HttpApiError.Unauthorized({})
    }
    return yield* effect
  })
}

/**
 * Bridge from the Effect HttpServerRequest to the standard `Request` shape
 * `cookieAuthorizesRequest` wants.  We only need URL + headers + method,
 * not the body — so we synthesise a body-less Request directly from the
 * available fields rather than going through `HttpServerRequest.toWeb` (which
 * is an effect and would force this helper to be effectful).
 */
function cookieDecisionFromHttpRequest(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
): "allow" | "deny" | "fallthrough" {
  const headers = new Headers()
  for (const [k, v] of Object.entries(request.headers)) {
    if (typeof v === "string") headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(","))
  }
  const synthetic = new Request(url.toString(), { method: request.method, headers })
  return cookieAuthorizesRequest(synthetic)
}

function decodeCredential(input: string) {
  return Encoding.decodeBase64String(input)
    .asEffect()
    .pipe(
      Effect.match({
        onFailure: emptyCredential,
        onSuccess: (header) => {
          const parts = header.split(":")
          if (parts.length !== 2) return emptyCredential()
          return {
            username: parts[0],
            password: Redacted.make(parts[1]),
          }
        },
      }),
    )
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
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect
        if (hasPtyConnectTicketURL(url)) return yield* effect

        const cookieDecision = cookieDecisionFromHttpRequest(request, url)
        if (cookieDecision === "allow") return yield* effect
        const mode = authMode()
        if (cookieDecision === "deny") {
          // Cookie present but not scoped to this resource.  No basic-auth
          // fallthrough (would leak the password's existence).  In collab
          // mode we drop the WWW-Authenticate header so the browser doesn't
          // pop its native dialog.
          return yield* Effect.succeed(
            HttpServerResponse.empty({
              status: UNAUTHORIZED,
              headers: mode === "collab" ? {} : { "www-authenticate": WWW_AUTHENTICATE },
            }),
          )
        }
        // fallthrough.  Collab mode: no basic-auth fallback.  Redirect HTML
        // navigations to OAuth, JSON 401 for everything else (still no
        // www-authenticate, so no native dialog).
        if (mode === "collab") {
          if (isHtmlNavigation(request)) {
            const next = url.pathname + url.search
            return yield* Effect.succeed(
              HttpServerResponse.empty({
                status: 302,
                headers: { location: "/collab/auth/github?next=" + encodeURIComponent(next) },
              }),
            )
          }
          return yield* Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: "Unauthorised" },
              { status: UNAUTHORIZED, headers: { "cache-control": "no-store" } },
            ),
          )
        }
        return yield* credentialFromURL(url, request).pipe(
          Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
        )
      })
  }),
)

function isHtmlNavigation(request: HttpServerRequest.HttpServerRequest): boolean {
  const accept = (request.headers.accept ?? "").toString()
  const fetchMode = (request.headers["sec-fetch-mode"] ?? "").toString()
  return fetchMode === "navigate" || accept.includes("text/html")
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
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
