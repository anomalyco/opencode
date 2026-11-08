import { Session } from "@Mackery6969/core/session"
import type { Snapshot } from "@Mackery6969/core/snapshot"
import { MessageNotFoundError, SessionNotFoundError, UnknownError } from "@Mackery6969/protocol/errors"
import { Effect } from "effect"

export function missingSession(error: Session.NotFoundError) {
  return new SessionNotFoundError({
    sessionID: error.sessionID,
    message: `Session not found: ${error.sessionID}`,
  })
}

export function missingMessage(error: Session.MessageNotFoundError) {
  return new MessageNotFoundError({
    sessionID: error.sessionID,
    messageID: error.messageID,
    message: `Message not found: ${error.messageID}`,
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

/** Snapshot repositories are host state clients cannot repair, so surface only a log reference. */
export function failedSnapshot(operation: string, sessionID: Session.ID) {
  return (error: Snapshot.Error) => {
    const ref = `err_${crypto.randomUUID().slice(0, 8)}`
    return Effect.logError(`failed to ${operation}`, { cause: error }).pipe(
      Effect.annotateLogs({ ref, sessionID }),
      Effect.andThen(
        Effect.fail(new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref })),
      ),
    )
  }
}
