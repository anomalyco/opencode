import { Session } from "@opencode/core/session"
import { SessionNotFoundError, UnknownError } from "@opencode/protocol/errors"
import { Effect } from "effect"

export function missingSession(error: Session.NotFoundError) {
  return new SessionNotFoundError({
    sessionID: error.sessionID,
    message: `Session not found: ${error.sessionID}`,
  })
}

export function failedMessageDecode(error: Session.MessageDecodeError) {
  const ref = `err_${crypto.randomUUID().slice(0, 8)}`
  return Effect.logError("failed to decode session message").pipe(
    Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
    Effect.andThen(
      Effect.fail(new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref })),
    ),
  )
}
