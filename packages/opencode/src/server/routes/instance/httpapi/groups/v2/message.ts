import { SessionID } from "@/session/schema"
import { SessionMessage } from "@/v2/session-message"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"

export const MessageGroup = HttpApiGroup.make("v2.message")
  .add(
    HttpApiEndpoint.get("messages", "/api/session/:sessionID/message", {
      params: { sessionID: SessionID },
      query: Schema.Union([
        Schema.Struct({
          limit: Schema.optional(
            Schema.NumberFromString.check(
              Schema.isInt(),
              Schema.isGreaterThanOrEqualTo(1),
              Schema.isLessThanOrEqualTo(200),
            ),
          ).annotate({
            description:
              "Maximum number of messages to return. When omitted, the endpoint returns its default page size.",
          }),
          order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
            description: "Message order for the first page. Use desc for newest first or asc for oldest first.",
          }),
          cursor: Schema.optional(Schema.Never),
        }),
        Schema.Struct({
          limit: Schema.optional(
            Schema.NumberFromString.check(
              Schema.isInt(),
              Schema.isGreaterThanOrEqualTo(1),
              Schema.isLessThanOrEqualTo(200),
            ),
          ).annotate({
            description:
              "Maximum number of messages to return. When omitted, the endpoint returns its default page size.",
          }),
          cursor: Schema.String.annotate({
            description:
              "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order.",
          }),
          order: Schema.optional(Schema.Never),
        }),
      ]).annotate({ identifier: "V2SessionMessagesQuery" }),
      success: Schema.Struct({
        items: Schema.Array(SessionMessage.Message),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "V2SessionMessagesResponse" }),
      error: HttpApiError.BadRequest,
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
  .middleware(Authorization)
