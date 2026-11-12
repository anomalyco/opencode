import { ServerIdentity } from "@opencode/core/server-identity"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@opencode/protocol/errors"
import { Duration, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { ServerAuth } from "../auth"

/** `auth.register` and `auth.login` in the `server.experimental` group. */
export const makeAuth = Effect.gen(function* () {
  const identity = yield* ServerIdentity.Service
  const auth = yield* ServerAuth.Config

  const signIn = (token: string, request: HttpServerRequest.HttpServerRequest) =>
    // The cookie lets browser navigations through without re-sending the token; API clients keep using it
    // as their Basic password.
    HttpServerResponse.jsonUnsafe({ token }).pipe(
      HttpServerResponse.setCookieUnsafe(ServerAuth.sessionCookieName(request.headers.host), token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: Duration.seconds(ServerAuth.SESSION_TTL_SECONDS),
      }),
    )

  const enabled = () =>
    auth.local
      ? Effect.void
      : Effect.fail(
          new ServiceUnavailableError({
            message: "Local accounts are not enabled on this server",
            service: "auth",
          }),
        )

  return {
    register: (payload: { readonly username: string; readonly password: string }) =>
      Effect.gen(function* () {
        yield* enabled()
        const request = yield* HttpServerRequest.HttpServerRequest
        const user = yield* identity.register(payload).pipe(
          Effect.catchTag("ServerIdentity.UsernameTakenError", (error) =>
            Effect.fail(new ConflictError({ message: error.message, resource: "username" })),
          ),
          Effect.catchTag("ServerIdentity.InvalidRegisterInputError", (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message })),
          ),
        )
        const { token } = yield* identity.issue({
          userID: user.id,
          method: "password",
          expiresAt: new Date(Date.now() + ServerAuth.SESSION_TTL_SECONDS * 1000),
        })
        return signIn(token, request)
      }),
    login: (payload: { readonly username: string; readonly password: string }) =>
      Effect.gen(function* () {
        yield* enabled()
        const request = yield* HttpServerRequest.HttpServerRequest
        const user = yield* identity.authenticate(payload).pipe(
          Effect.catchTag("ServerIdentity.InvalidCredentialsError", () =>
            Effect.fail(new UnauthorizedError({ message: "Invalid username or password" })),
          ),
          Effect.catchTag("ServerIdentity.AttemptLockedError", (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message })),
          ),
        )
        const { token } = yield* identity.issue({
          userID: user.id,
          method: "password",
          expiresAt: new Date(Date.now() + ServerAuth.SESSION_TTL_SECONDS * 1000),
        })
        return signIn(token, request)
      }),
  }
})
