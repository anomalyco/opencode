import { Form } from "@opencode-ai/schema/form"
import { Location } from "@opencode-ai/schema/location"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InvalidRequestError,
  SessionNotFoundError,
} from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const CreatePayload = Schema.Struct({
  id: Form.ID.pipe(Schema.optional),
  title: Form.FormInfo.fields.title,
  metadata: Form.FormInfo.fields.metadata,
  mode: Schema.Literals(["form", "url"]),
  fields: Form.FormInfo.fields.fields.pipe(Schema.optional),
  url: Form.UrlInfo.fields.url.pipe(Schema.optional),
}).annotate({ identifier: "Form.CreatePayload" })

export type CreatePayload = typeof CreatePayload.Type

// Form routes intentionally look session-scoped, but use a form-specific middleware instead of
// SessionLocationMiddleware. The middleware treats real session IDs normally and has an
// undocumented `global` sentinel branch for MCP elicitation forms that are still Location-scoped
// but not session-owned. This is temporary and should disappear once elicitations are attributable.
export const makeFormGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
  formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>,
) =>
  HttpApiGroup.make("server.form")
    .add(
      HttpApiEndpoint.get("form.request.list", "/api/form/request", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Form.Info)),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.form.request.list",
            summary: "List pending form requests",
            description: "Retrieve pending forms for a location.",
          }),
        ),
    )
    .middleware(locationMiddleware)
    .add(
      HttpApiEndpoint.get("session.form.list", "/api/session/:sessionID/form", {
        params: { sessionID: Schema.String },
        success: Schema.Struct({ data: Schema.Array(Form.Info) }),
        error: SessionNotFoundError,
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.list",
            summary: "List session forms",
            description: "Retrieve pending forms for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.form.create", "/api/session/:sessionID/form", {
        params: { sessionID: Schema.String },
        payload: CreatePayload,
        success: Schema.Struct({ data: Form.Info }),
        error: [SessionNotFoundError, ConflictError, InvalidRequestError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.create",
            summary: "Create session form",
            description: "Create a form for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.form.get", "/api/session/:sessionID/form/:formID", {
        params: { sessionID: Schema.String, formID: Form.ID },
        success: Schema.Struct({ data: Form.Info }),
        error: [SessionNotFoundError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.get",
            summary: "Get session form",
            description: "Retrieve a form for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.form.state", "/api/session/:sessionID/form/:formID/state", {
        params: { sessionID: Schema.String, formID: Form.ID },
        success: Schema.Struct({ data: Form.State }),
        error: [SessionNotFoundError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.state",
            summary: "Get form state",
            description: "Retrieve the current state for a form.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.form.reply", "/api/session/:sessionID/form/:formID/reply", {
        params: { sessionID: Schema.String, formID: Form.ID },
        payload: Form.Reply,
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, FormAlreadySettledError, FormInvalidAnswerError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.reply",
            summary: "Reply to form",
            description: "Submit an answer to a pending form.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.form.cancel", "/api/session/:sessionID/form/:formID/cancel", {
        params: { sessionID: Schema.String, formID: Form.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, FormAlreadySettledError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.form.cancel",
            summary: "Cancel form",
            description: "Cancel a pending form.",
          }),
        ),
    )
    .annotateMerge(OpenApi.annotations({ title: "forms", description: "Session form routes." }))
