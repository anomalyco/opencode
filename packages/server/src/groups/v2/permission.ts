import { PermissionV2 } from "@opencode-ai/core/permission"
import { Location } from "@opencode-ai/core/location"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { PermissionNotFoundError, SessionNotFoundError } from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const PermissionGroup = HttpApiGroup.make("v2.permission")
  .add(
    HttpApiEndpoint.get("permissionRequests", "/api/permission/request", {
      query: LocationQuery,
      success: Location.response(Schema.Array(PermissionV2.Request)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.request.list",
          summary: "List pending permission requests",
          description: "Retrieve pending permission requests for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 permissions", description: "Experimental v2 permission routes." }))
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)

export const SessionPermissionGroup = HttpApiGroup.make("v2.session.permission")
  .add(
    HttpApiEndpoint.get("sessionPermissionRequests", "/api/session/:sessionID/permission/request", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Struct({ data: Schema.Array(PermissionV2.Request) }),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.permission.list",
        summary: "List session permission requests",
        description: "Retrieve pending permission requests owned by a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("permissionRequestReply", "/api/session/:sessionID/permission/request/:requestID/reply", {
      params: { sessionID: SessionV2.ID, requestID: PermissionV2.ID },
      payload: Schema.Struct({
        reply: PermissionV2.Reply,
        message: Schema.String.pipe(Schema.optional),
      }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, PermissionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.permission.reply",
        summary: "Reply to pending permission request",
        description: "Respond to a pending permission request owned by a session.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "v2 session permissions", description: "Experimental v2 session permission routes." }),
  )
  .middleware(V2Authorization)

export const PermissionSavedGroup = HttpApiGroup.make("v2.permission.saved")
  .add(
    HttpApiEndpoint.get("savedPermissions", "/api/permission/saved", {
      query: Schema.Struct({ projectID: ProjectV2.ID.pipe(Schema.optional) }),
      success: Schema.Struct({ data: Schema.Array(PermissionSaved.Info) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.permission.saved.list",
        summary: "List saved permissions",
        description: "Retrieve saved permissions, optionally filtered by project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("removeSavedPermission", "/api/permission/saved/:id", {
      params: { id: PermissionSaved.ID },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.permission.saved.remove",
        summary: "Remove saved permission",
        description: "Remove a saved permission by ID.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "v2 saved permissions", description: "Experimental v2 saved permission routes." }),
  )
  .middleware(V2Authorization)
