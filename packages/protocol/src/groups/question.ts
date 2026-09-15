import { Question } from "@opencode-ai/schema/question"
import { Location } from "@opencode-ai/schema/location"
import { Session } from "@opencode-ai/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { QuestionNotFoundError, SessionNotFoundError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const makeQuestionGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
) =>
  HttpApiGroup.make("server.question")
    .add(
      HttpApiEndpoint.get("question.request.list", "/api/question/request", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Question.Request)),
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
    // Effect applies group middleware only to endpoints already added; session endpoints use session placement below.
    .middleware(locationMiddleware)
    .add(
      HttpApiEndpoint.get("session.question.list", "/api/session/:sessionID/question", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(Question.Request) }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
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
        params: { sessionID: Session.ID, requestID: Question.ID },
        payload: Question.Reply,
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, QuestionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
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
        params: { sessionID: Session.ID, requestID: Question.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, QuestionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
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
