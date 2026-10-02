import { ClientError } from "@opencode/client/effect"
import { InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { ACPError } from "./error"

export function classify(error: unknown): Effect.Effect<never, ACPError.Error> {
  if (
    error instanceof ClientError &&
    HttpClientError.isHttpClientError(error.cause) &&
    isConnectionFailure(error.cause)
  )
    return Effect.fail(new ACPError.ServerUnavailableError())
  if (error instanceof SessionNotFoundError)
    return Effect.fail(new ACPError.SessionNotFoundError({ sessionId: error.sessionID }))
  if (error instanceof InvalidRequestError)
    return Effect.fail(new ACPError.InvalidRequestError({ message: error.message, field: error.field }))
  return Effect.die(error)
}

// The client reports a failed body read as a `DecodeError` with a cause; its other `DecodeError`s have none.
function isConnectionFailure(error: HttpClientError.HttpClientError) {
  return (
    error.reason._tag === "TransportError" || (error.reason._tag === "DecodeError" && error.reason.cause !== undefined)
  )
}

export function decodeSessionID(value: string) {
  return Schema.decodeUnknownEffect(Session.ID)(value).pipe(
    Effect.mapError(() => new ACPError.InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
}

export * as ACPClient from "./client"
