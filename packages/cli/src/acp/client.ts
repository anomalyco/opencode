import { ClientError } from "@opencode/client/effect"
import { InvalidCursorError, InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { ACPError } from "./error"

export function classify(error: unknown): Effect.Effect<never, ACPError.Error> {
  if (
    error instanceof ClientError &&
    HttpClientError.isHttpClientError(error.cause) &&
    // The client reports a failed body read as a `DecodeError` with a cause; its other `DecodeError`s have none.
    (error.cause.reason._tag === "TransportError" ||
      (error.cause.reason._tag === "DecodeError" && error.cause.reason.cause !== undefined))
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

export function decodeSessionID(value: string) {
  return Schema.decodeUnknownEffect(Session.ID)(value).pipe(
    Effect.mapError(() => new ACPError.InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
}

export * as ACPClient from "./client"
