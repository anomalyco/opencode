import { SessionID } from "@/session/schema"
import { SessionMessage } from "@/v2/session-message"
import { Prompt } from "@/v2/session-prompt"
import { SessionV2 } from "@/v2/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./middleware/authorization"

export const V2Api = HttpApi.make("v2")
  .add(
    HttpApiGroup.make("v2")
      .add(
        HttpApiEndpoint.get("messages", "/api/session/:sessionID/message", {
          params: { sessionID: SessionID },
          query: Schema.Struct({
            limit: Schema.optional(
              Schema.NumberFromString.check(
                Schema.isInt(),
                Schema.isGreaterThanOrEqualTo(1),
                Schema.isLessThanOrEqualTo(200),
              ),
            ).annotate({
              description:
                "Maximum number of messages to return. When omitted, the endpoint returns its default page size. Use limit without a cursor to fetch the newest page for chat history.",
            }),
            before: Schema.optional(Schema.String).annotate({
              description:
                "Opaque pagination cursor for the item at the start of the current window. Returns messages older than this cursor. Mutually exclusive with after.",
            }),
            after: Schema.optional(Schema.String).annotate({
              description:
                "Opaque pagination cursor for the item at the end of the current window. Returns messages newer than this cursor. Mutually exclusive with before.",
            }),
            from: Schema.optional(Schema.Literal("start")).annotate({
              description:
                "Start from the beginning of session history instead of the newest messages. Mutually exclusive with before and after.",
            }),
          }).annotate({ identifier: "V2SessionMessagesQuery" }),
          success: Schema.Struct({
            items: Schema.Array(SessionMessage.Message),
            before: Schema.String.pipe(Schema.optional),
            after: Schema.String.pipe(Schema.optional),
          }).annotate({ identifier: "V2SessionMessagesResponse" }),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.messages",
            summary: "Get v2 session messages",
            description:
              "Retrieve projected v2 messages for a session. For chat clients, request the latest page with limit, page backward through older history with before, and catch up with newer messages using after.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("prompt", "/api/session/:sessionID/prompt", {
          params: { sessionID: SessionID },
          payload: Schema.Struct({
            prompt: Prompt,
            delivery: SessionV2.Delivery.pipe(Schema.optional),
          }),
          success: SessionMessage.Message,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.prompt",
            summary: "Send v2 message",
            description: "Create a v2 session message and queue it for the agent loop.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("compact", "/api/session/:sessionID/compact", {
          params: { sessionID: SessionID },
          success: HttpApiSchema.NoContent,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.compact",
            summary: "Compact v2 session",
            description: "Compact a v2 session conversation.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("wait", "/api/session/:sessionID/wait", {
          params: { sessionID: SessionID },
          success: HttpApiSchema.NoContent,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.wait",
            summary: "Wait for v2 session",
            description: "Wait for a v2 session agent loop to become idle.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "v2",
          description: "Experimental v2 routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export * as V2HttpApi from "./v2"
