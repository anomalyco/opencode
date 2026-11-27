import { ClientError } from "@opencode/client/effect"
import {
  CommandExecutionError,
  CommandNotFoundError,
  InvalidCursorError,
  InvalidRequestError,
  SessionNotFoundError,
} from "@opencode/protocol/errors"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/http"
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
  if (error instanceof CommandNotFoundError)
    return Effect.fail(new ACPError.InvalidRequestError({ message: error.message, field: "prompt" }))
  // The message is the command's own, such as its usage, so the client shows it instead of a generic failure.
  if (error instanceof CommandExecutionError)
    return Effect.fail(
      new ACPError.ServiceFailureError({
        safeMessage: error.message,
        service: "command",
        errorName: "CommandExecutionError",
      }),
    )
  return Effect.die(error)
}

export function decodeSessionID(value: string) {
  return Schema.decodeUnknownEffect(Session.ID)(value).pipe(
    Effect.mapError(() => new ACPError.InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
}

export * as ACPClient from "./client"
