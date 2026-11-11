import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { PublicLocationSwitched, SessionMessagesQuery } from "@opencode/schema/session-message-page"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidCursorError, SessionNotFoundError, UnknownError } from "../errors.js"

export { SessionMessagesQuery }

export const PublicSessionMessage = Schema.Union([
  SessionMessage.AgentSelected,
  SessionMessage.ModelSelected,
  PublicLocationSwitched,
  SessionMessage.User,
  SessionMessage.Synthetic,
  SessionMessage.System,
  SessionMessage.Skill,
  SessionMessage.Shell,
  SessionMessage.Assistant,
  SessionMessage.Compaction,
  SessionMessage.Idle,
]).annotate({ identifier: "Session.Message.Info" })

/**
 * Experimental: {@link PublicSessionMessage} as sent to clients that opt in with `X-OpenCode-Capabilities:
 * experimental-media-uri` while `experimental.media_blob` is on. User files stored in `blob` stay `media:` refs.
 */
export const PublicMediaSessionMessage = Schema.Union([
  SessionMessage.AgentSelected,
  SessionMessage.ModelSelected,
  PublicLocationSwitched,
  SessionMessage.MediaUser,
  SessionMessage.Synthetic,
  SessionMessage.System,
  SessionMessage.Skill,
  SessionMessage.Shell,
  SessionMessage.Assistant,
  SessionMessage.Compaction,
  SessionMessage.Idle,
]).annotate({ identifier: "Session.Message.MediaInfo" })

const MessagesCursor = Schema.Struct({
  previous: Schema.String.pipe(Schema.optional),
  next: Schema.String.pipe(Schema.optional),
})

/** Experimental: the `session.messages` response for clients that opt into `experimental-media-uri`. */
export const SessionMediaMessagesResponse = Schema.Struct({
  data: Schema.Array(PublicMediaSessionMessage),
  cursor: MessagesCursor,
})

/** Experimental: the `session.message` response for clients that opt into `experimental-media-uri`. */
export const SessionMediaMessageResponse = Schema.Struct({ data: PublicMediaSessionMessage })

export const MessageGroup = HttpApiGroup.make("server.message")
  .add(
    HttpApiEndpoint.get("session.messages", "/api/session/:sessionID/message", {
      params: { sessionID: Session.ID },
      query: SessionMessagesQuery,
      success: Schema.Struct({
        data: Schema.Array(PublicSessionMessage),
        cursor: MessagesCursor,
      }).annotate({ identifier: "SessionMessagesResponse" }),
      error: [InvalidCursorError, SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.message.list",
        summary: "Get session messages",
        description:
          "Retrieve projected messages for a session, optionally filtered by type. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline, passing the same type filter on each page.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "session",
      description: "Experimental message routes.",
    }),
  )
