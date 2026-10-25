import { Agent } from "@bolt-ai/schema/agent"
import { Location } from "@bolt-ai/schema/location"
import { Permission } from "@bolt-ai/schema/permission"
import { PermissionSaved } from "@bolt-ai/schema/permission-saved"
import { Project } from "@bolt-ai/schema/project"
import { Session } from "@bolt-ai/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  ConflictError,
  LocationNotFoundError,
  PermissionNotFoundError,
  PermissionSavedNotFoundError,
  SessionNotFoundError,
} from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const makePermissionGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
) =>
  HttpApiGroup.make("server.permission")
    .add(
      HttpApiEndpoint.get("permission.request.list", "/api/permission/request", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Permission.Request)),
      })
        .middleware(locationMiddleware)
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "permission.request.list",
            summary: "List pending permission requests",
            description: "Retrieve pending permission requests for a location.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("permission.saved.list", "/api/permission/saved", {
        query: Schema.Struct({ projectID: Project.ID.pipe(Schema.optional) }),
        success: Schema.Struct({ data: Schema.Array(PermissionSaved.Info) }),
      })
        .middleware(locationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "permission.saved.list",
            summary: "List saved permissions",
            description: "Retrieve saved permissions, optionally filtered by project.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.patch("permission.saved.update", "/api/permission/saved/:id", {
        params: { id: PermissionSaved.ID },
        payload: Schema.Struct({
          action: Schema.String.pipe(Schema.optional),
          resource: Schema.String.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: PermissionSaved.Info }),
        error: [PermissionSavedNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "permission.saved.update",
          summary: "Update saved permission",
          description:
            "Change the action or resource of a saved permission. Fails with a conflict when the project already has a saved permission with the same action and resource.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.delete("permission.saved.remove", "/api/permission/saved/:id", {
        params: { id: PermissionSaved.ID },
        success: HttpApiSchema.NoContent,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "permission.saved.remove",
          summary: "Remove saved permission",
          description: "Remove a saved permission by ID.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.permission.create", "/api/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: Permission.ID.pipe(Schema.optional),
          action: Permission.Request.fields.action,
          resources: Permission.Request.fields.resources,
          save: Permission.Request.fields.save,
          metadata: Permission.Request.fields.metadata,
          source: Permission.Request.fields.source,
          agent: Agent.ID.pipe(Schema.optional),
        }),
        success: Schema.Struct({
          data: Schema.Struct({ id: Permission.ID, effect: Permission.Effect }),
        }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.permission.create",
            summary: "Create permission request",
            description: "Evaluate and, when approval is required, create a permission request for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.permission.list", "/api/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(Permission.Request) }),
        error: [SessionNotFoundError, LocationNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.permission.list",
          summary: "List session permission requests",
          description: "Retrieve pending permission requests owned by a session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.permission.get", "/api/session/:sessionID/permission/:requestID", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        success: Schema.Struct({ data: Permission.Request }),
        error: [SessionNotFoundError, PermissionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.permission.get",
            summary: "Get permission request",
            description: "Retrieve a pending permission request owned by a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.permission.reply", "/api/session/:sessionID/permission/:requestID/reply", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        payload: Schema.Struct({
          decision: Permission.Reply,
          message: Schema.String.pipe(Schema.optional),
        }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, PermissionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.permission.reply",
            summary: "Reply to pending permission request",
            description: "Respond to a pending permission request owned by a session.",
          }),
        ),
    )
    .annotateMerge(OpenApi.annotations({ title: "permission", description: "Experimental permission routes." }))
