import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { PermissionNotFoundError, SessionNotFoundError } from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const PermissionGroup = HttpApiGroup.make("v2.permission")
  .add(
    HttpApiEndpoint.get("permissions", "/api/permission", {
      query: LocationQuery,
      success: Schema.Array(PermissionV2.Request),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.list",
          summary: "List pending permissions",
          description: "Retrieve pending permission requests for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 permissions", description: "Experimental v2 permission routes." }))
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)

export const SessionPermissionGroup = HttpApiGroup.make("v2.session.permission")
  .add(
    HttpApiEndpoint.get("sessionPermissions", "/api/session/:sessionID/permission", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Array(PermissionV2.Request),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.permission.forSession",
        summary: "List session pending permissions",
        description: "Retrieve pending permission requests owned by a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("permissionReply", "/api/session/:sessionID/permission/:requestID/reply", {
      params: { sessionID: SessionV2.ID, requestID: PermissionV2.ID },
      payload: Schema.Struct({
        reply: PermissionV2.Reply,
        message: Schema.String.pipe(Schema.optional),
      }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, PermissionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.permission.reply",
        summary: "Reply to pending permission",
        description: "Respond to a pending permission request owned by a session.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 session permissions", description: "Experimental v2 session permission routes." }))
  .middleware(V2Authorization)
