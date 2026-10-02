import { ClientError } from "@opencode/client/effect"
import { InvalidCursorError, InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { ACPError } from "./error"

/** Keeps the OpenCode client failures ACP reports. Any other failure is a defect. */
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
  if (error instanceof InvalidCursorError)
    return Effect.fail(new ACPError.InvalidRequestError({ message: error.message, field: "cursor" }))
  return Effect.die(error)
}

// The client reads every body through the response stream or buffer, which report a failed read as a `DecodeError`
// carrying the read's cause. Its other `DecodeError`s, for an undeclared status or content type, have no cause, and
// a body that fails to parse or decode fails with a `SchemaError` instead.
function isConnectionFailure(error: HttpClientError.HttpClientError) {
  return (
    error.reason._tag === "TransportError" || (error.reason._tag === "DecodeError" && error.reason.cause !== undefined)
  )
}

/** The client rejects a malformed ID before sending it, so it is rejected here as the server would. */
export function decodeSessionID(value: string) {
  return Schema.decodeUnknownEffect(Session.ID)(value).pipe(
    Effect.mapError(() => new ACPError.InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
}

export * as ACPClient from "./client"
