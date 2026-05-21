import { SessionID } from "@/session/schema"
import { SessionMessage } from "@opencode-ai/core/session-message"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidCursorError, SessionNotFoundError, UnknownError } from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"

export const MessagesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
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
}).annotate({ identifier: "V2SessionMessagesQuery" })

export const MessageGroup = HttpApiGroup.make("v2.message")
  .add(
    HttpApiEndpoint.get("messages", "/api/session/:sessionID/message", {
      params: { sessionID: SessionID },
      query: MessagesQuery,
      success: Schema.Struct({
        items: Schema.Array(SessionMessage.Message),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "V2SessionMessagesResponse" }),
      error: [InvalidCursorError, SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.messages",
        summary: "Get v2 session messages",
        description:
          "Retrieve projected v2 messages for a session. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 messages",
      description: "Experimental v2 message routes.",
    }),
  )
  .middleware(V2Authorization)
