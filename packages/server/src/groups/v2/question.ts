import { QuestionV2 } from "@opencode-ai/core/question"
import { Location } from "@opencode-ai/core/location"
import { SessionV2 } from "@opencode-ai/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { QuestionNotFoundError, SessionNotFoundError } from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const QuestionGroup = HttpApiGroup.make("v2.question")
  .add(
    HttpApiEndpoint.get("questionRequests", "/api/question/request", {
      query: LocationQuery,
      success: Location.response(Schema.Array(QuestionV2.Request)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.question.request.list",
          summary: "List pending question requests",
          description: "Retrieve pending question requests for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 questions", description: "Experimental v2 question routes." }))
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)

export const SessionQuestionGroup = HttpApiGroup.make("v2.session.question")
  .add(
    HttpApiEndpoint.post("questionRequestReply", "/api/session/:sessionID/question/request/:requestID/reply", {
      params: { sessionID: SessionV2.ID, requestID: QuestionV2.ID },
      payload: QuestionV2.Reply,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, QuestionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.question.reply",
        summary: "Reply to pending question request",
        description: "Answer a pending question request owned by a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("questionRequestReject", "/api/session/:sessionID/question/request/:requestID/reject", {
      params: { sessionID: SessionV2.ID, requestID: QuestionV2.ID },
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, QuestionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.question.reject",
        summary: "Reject pending question request",
        description: "Reject a pending question request owned by a session.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "v2 session questions", description: "Experimental v2 session question routes." }),
  )
  .middleware(V2Authorization)
