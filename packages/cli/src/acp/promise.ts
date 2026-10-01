import { RequestError } from "@agentclientprotocol/sdk"
import { ClientError, isInvalidRequestError, isSessionNotFoundError } from "@opencode/client/promise"
import { Effect } from "effect"
import { ACPError } from "./error"

/** Runs a promise, keeping ACP failures typed. Any other rejection is a defect. */
export const promise = <A>(evaluate: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(Effect.catch(classify))

export function classify(cause: unknown): Effect.Effect<never, ACPError.Error | RequestError> {
  if (cause instanceof RequestError || ACPError.is(cause)) return Effect.fail(cause)
  if (cause instanceof ClientError && cause.reason === "Transport")
    return Effect.fail(new ACPError.ServerUnavailableError())
  if (isSessionNotFoundError(cause))
    return Effect.fail(new ACPError.SessionNotFoundError({ sessionId: cause.sessionID }))
  if (isInvalidRequestError(cause))
    return Effect.fail(new ACPError.InvalidRequestError({ message: cause.message, field: cause.field }))
  return Effect.die(cause)
}

export * as ACPPromise from "./promise"
