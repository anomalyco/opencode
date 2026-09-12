import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidCursorError, InvalidRequestError, SessionNotFoundError, UnknownError } from "../errors"

export const SessionMessagesQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ).annotate({
    description: "Maximum number of messages to return. When omitted, the endpoint returns its default page size.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description:
      "Message order for the first page or seek. Use desc for newest first or asc for oldest first. Do not combine with cursor.",
  }),
  cursor: Schema.optional(
    Schema.String.annotate({
      description:
        "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order, index, or around.",
    }),
  ),
  index: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt))).annotate({
    description:
      "Zero-based dense rank seek in the requested order. Opens one page at that position. Do not combine with cursor or around.",
  }),
  around: Schema.optional(SessionMessage.ID).annotate({
    description:
      "Open a page centered on this projected message ID. Do not combine with cursor or index.",
  }),
}).annotate({ identifier: "SessionMessagesQuery" })

export const MessageGroup = HttpApiGroup.make("server.message")
  .add(
    HttpApiEndpoint.get("session.messages", "/api/session/:sessionID/message", {
      params: { sessionID: Session.ID },
      query: SessionMessagesQuery,
      success: Schema.Struct({
        data: Schema.Array(SessionMessage.Message),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
        total: NonNegativeInt,
        startIndex: NonNegativeInt.pipe(Schema.optional),
      }).annotate({ identifier: "SessionMessagesResponse" }),
      error: [InvalidCursorError, InvalidRequestError, SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.messages",
        summary: "Get session messages",
        description:
          "Retrieve projected messages for a session. Use order for an edge page, cursor for sequential walks, index for dense-rank seek, or around to center on a message ID. Responses include total and optional startIndex.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "messages",
      description: "Experimental message routes.",
    }),
  )
