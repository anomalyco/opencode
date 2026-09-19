import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { PermissionAutoLeaseNotFoundError, PermissionNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/permission"
const ReplyPayload = Schema.Struct({
  reply: PermissionV1.Reply,
  message: Schema.optional(Schema.String),
})
const AutoAcquirePayload = Schema.Struct({
  scope: PermissionV1.AutoScope,
  ttl: PermissionV1.AutoAcquireBody.fields.ttl,
})

export const PermissionApi = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PermissionV1.Request), "List of pending permissions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.get("autoList", `${root}/auto`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PermissionV1.AutoLease), "Active auto-approve leases"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.autoList",
            summary: "List auto-approve leases",
            description: "List the auto-approve leases that have not expired or been released.",
          }),
        ),
        HttpApiEndpoint.post("autoAcquire", `${root}/auto`, {
          query: WorkspaceRoutingQuery,
          payload: AutoAcquirePayload,
          success: described(PermissionV1.AutoLease, "Acquired lease"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.autoAcquire",
            summary: "Acquire an auto-approve lease",
            description:
              "Auto-approve requests in scope that would otherwise ask, without publishing permission.asked. Explicit deny rules still apply, requests already pending are unaffected, and the lease expires unless renewed within its ttl.",
          }),
        ),
        HttpApiEndpoint.post("autoRenew", `${root}/auto/:leaseID/renew`, {
          params: { leaseID: PermissionV1.AutoLeaseID },
          query: WorkspaceRoutingQuery,
          success: described(PermissionV1.AutoLease, "Renewed lease"),
          error: PermissionAutoLeaseNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.autoRenew",
            summary: "Renew an auto-approve lease",
            description: "Extend a lease by its ttl. Fails once the lease has expired or been released.",
          }),
        ),
        HttpApiEndpoint.delete("autoRelease", `${root}/auto/:leaseID`, {
          params: { leaseID: PermissionV1.AutoLeaseID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Lease released"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.autoRelease",
            summary: "Release an auto-approve lease",
            description: "Release a lease immediately instead of waiting for it to expire.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionV1.ID },
          query: WorkspaceRoutingQuery,
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, PermissionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
