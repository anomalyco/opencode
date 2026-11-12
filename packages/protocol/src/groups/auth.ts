import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, UnauthorizedError } from "../errors.js"

const EXPERIMENTAL = "Experimental: may change without notice."

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.auth.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const Credentials = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
}).annotate({ identifier: "AuthCredentials" })
export type Credentials = typeof Credentials.Type

export const Session = Schema.Struct({
  token: Schema.String,
}).annotate({ identifier: "AuthSession" })
export type Session = typeof Session.Type

export const AUTH_REGISTER_PATH = "/api/experimental/auth/register"
export const AUTH_LOGIN_PATH = "/api/experimental/auth/login"

// Sign-in routes must stay reachable without credentials, wherever the request is gated before dispatch.
const SIGN_IN_PATHS = new Set([AUTH_REGISTER_PATH, AUTH_LOGIN_PATH])

export function isSignInURL(url: URL) {
  return SIGN_IN_PATHS.has(url.pathname)
}

/** `auth.*` in the `server.experimental` group. */
export const AuthEndpoints = [
  HttpApiEndpoint.post("auth.register", AUTH_REGISTER_PATH, {
    payload: Credentials,
    success: Session,
    error: [InvalidRequestError, ConflictError, ServiceUnavailableError],
  }).annotateMerge(
    annotations(
      "register",
      "Register a local account",
      "Create a local account from a username and password, sign in, and return a session token.",
    ),
  ),
  HttpApiEndpoint.post("auth.login", AUTH_LOGIN_PATH, {
    payload: Credentials,
    success: Session,
    error: [InvalidRequestError, UnauthorizedError, ServiceUnavailableError],
  }).annotateMerge(
    annotations(
      "login",
      "Sign in to a local account",
      "Verify a username and password against local accounts and return a session token.",
    ),
  ),
]
