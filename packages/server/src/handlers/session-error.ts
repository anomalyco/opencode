import { Session } from "@opencode/core/session"
import type { Snapshot } from "@opencode/core/snapshot"
import { MessageNotFoundError, UnknownError } from "@opencode/protocol/errors"
import { Effect } from "effect"

export { failedMessageDecode, missingSession } from "@opencode/core/session/message-page"

export function missingMessage(error: Session.MessageNotFoundError) {
  return new MessageNotFoundError({
    sessionID: error.sessionID,
    messageID: error.messageID,
    message: `Message not found: ${error.messageID}`,
  })
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
