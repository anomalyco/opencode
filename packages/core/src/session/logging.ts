import { Cause, Effect } from "effect"
import { SessionSchema } from "./schema"

export const logFailure = (
  message: "Failed to drain Session" | "Failed to wake Session",
  sessionID: SessionSchema.ID,
  cause: Cause.Cause<unknown>,
) => Effect.logError(message, cause).pipe(Effect.annotateLogs({ sessionID }))
