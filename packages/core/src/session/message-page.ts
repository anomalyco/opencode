export * as MessagePage from "./message-page.js"

import { InvalidCursorError, SessionNotFoundError, UnknownError } from "@opencode/schema/api-error"
import type { SessionMessagesQuery } from "@opencode/schema/session-message-page"
import { Effect, Option, Schema } from "effect"
import type { Session } from "../session.js"
import { SessionMessage } from "./message.js"
import type { SessionStore } from "./store.js"

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Literals(["asc", "desc"]),
  direction: Schema.Literals(["previous", "next"]),
})
const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor))

export const list = Effect.fn("MessagePage.list")(function* <M extends { readonly id: SessionMessage.ID }>(
  read: (
    input: SessionStore.MessagesInput,
  ) => Effect.Effect<ReadonlyArray<M>, Session.NotFoundError | Session.MessageDecodeError>,
  input: SessionMessagesQuery & { readonly sessionID: Session.ID },
) {
  if (input.cursor && input.order !== undefined)
    return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
  const decoded = input.cursor
    ? (Option.getOrUndefined(decodeCursor(Buffer.from(input.cursor, "base64url").toString("utf8"))) ??
      (yield* new InvalidCursorError({ message: "Invalid cursor" })))
    : undefined
  const order = decoded?.order ?? input.order ?? "desc"
  const messages = yield* read({ ...input, limit: input.limit ?? 50, order, cursor: decoded }).pipe(
    Effect.catchTag("Session.NotFoundError", missingSession),
    Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
  )
  const cursor = (message: M | undefined, direction: "previous" | "next") =>
    message ? Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url") : undefined
  return {
    data: messages,
    cursor: { previous: cursor(messages[0], "previous"), next: cursor(messages.at(-1), "next") },
  }
})

export function missingSession(error: Session.NotFoundError) {
  return new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` })
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
