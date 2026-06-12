import { QuestionV2 } from "@opencode-ai/core/question"
import { Location } from "@opencode-ai/core/location"
import { SessionV2 } from "@opencode-ai/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { QuestionNotFoundError, SessionNotFoundError } from "../errors"
import { SessionLocationMiddleware } from "../middleware/session-location"
import { LocationQuery, locationQueryOpenApi, LocationMiddleware } from "./location"

export const QuestionGroup = HttpApiGroup.make("server.question")
  .add(
    HttpApiEndpoint.get("question.request.list", "/api/question/request", {
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
  .annotateMerge(OpenApi.annotations({ title: "questions", description: "Experimental question routes." }))
  .middleware(LocationMiddleware)
  .add(
    HttpApiEndpoint.get("session.question.list", "/api/session/:sessionID/question", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Struct({ data: Schema.Array(QuestionV2.Request) }),
      error: SessionNotFoundError,
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.question.list",
          summary: "List session question requests",
          description: "Retrieve pending question requests owned by a session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.question.reply", "/api/session/:sessionID/question/:requestID/reply", {
      params: { sessionID: SessionV2.ID, requestID: QuestionV2.ID },
      payload: QuestionV2.Reply,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, QuestionNotFoundError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.question.reply",
          summary: "Reply to pending question request",
          description: "Answer a pending question request owned by a session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.question.reject", "/api/session/:sessionID/question/:requestID/reject", {
      params: { sessionID: SessionV2.ID, requestID: QuestionV2.ID },
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, QuestionNotFoundError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.question.reject",
          summary: "Reject pending question request",
          description: "Reject a pending question request owned by a session.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "session questions", description: "Experimental session question routes." }),
  )
