import { ClientError } from "@opencode/client/effect"
import { InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { ACPError } from "./error"

/** Keeps the OpenCode client failures ACP reports. Any other failure is a defect. */
export function classify(error: unknown): Effect.Effect<never, ACPError.Error> {
  if (
    error instanceof ClientError &&
    HttpClientError.isHttpClientError(error.cause) &&
    error.cause.reason._tag === "TransportError"
  )
    return Effect.fail(new ACPError.ServerUnavailableError())
  if (error instanceof SessionNotFoundError)
    return Effect.fail(new ACPError.SessionNotFoundError({ sessionId: error.sessionID }))
  if (error instanceof InvalidRequestError)
    return Effect.fail(new ACPError.InvalidRequestError({ message: error.message, field: error.field }))
  return Effect.die(error)
}

export * as ACPClient from "./client"
