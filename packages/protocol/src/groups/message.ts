import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { optional } from "@opencode-ai/schema/schema"
import { Event } from "@opencode-ai/schema/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidCursorError, SessionNotFoundError, UnknownError } from "../errors.js"

export const SessionMessagesQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ).annotate({
    description: "Maximum number of messages to return. When omitted, the endpoint returns its default page size.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Message order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  cursor: Schema.optional(
    Schema.String.annotate({
      description:
        "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order.",
    }),
  ),
}).annotate({ identifier: "SessionMessagesQuery" })

export const MessageGroup = HttpApiGroup.make("server.message")
  .add(
    HttpApiEndpoint.get("session.messages", "/api/session/:sessionID/message", {
      params: { sessionID: Session.ID },
      query: SessionMessagesQuery,
      success: Schema.Struct({
        data: Schema.Array(SessionMessage.Message),
        watermark: optional(Event.Seq).annotate({
          description:
            "Durable log seq this snapshot was computed at, read before the snapshot. Attach a live log read after the watermark to compose fetch and stream gap-free; events between the watermark and the snapshot read may be redelivered by the tail and are safe to re-apply. Absent when the session has no durable events.",
        }),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "SessionMessagesResponse" }),
      error: [InvalidCursorError, SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.messages",
        summary: "Get session messages",
        description:
          "Retrieve projected messages for a session. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "session",
      description: "Experimental message routes.",
    }),
  )
