import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdapterEntry } from "@/control-plane/types"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/experimental/workspace"
export const CreatePayload = Schema.Struct(Struct.omit(Workspace.CreateInput.fields, ["projectID"]))
export const WarpPayload = Schema.Struct({
  id: Schema.NullOr(Workspace.Info.fields.id),
  sessionID: Workspace.SessionWarpInput.fields.sessionID,
})

export const WorkspacePaths = {
  adapters: `${root}/adapter`,
  list: root,
  status: `${root}/status`,
  remove: `${root}/:id`,
  warp: `${root}/warp`,
} as const

export const WorkspaceApi = HttpApi.make("workspace")
  .add(
    HttpApiGroup.make("workspace")
      .add(
        HttpApiEndpoint.get("adapters", WorkspacePaths.adapters, {
          success: described(Schema.Array(WorkspaceAdapterEntry), "Workspace adapters"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.adapter.list",
            summary: "List workspace adapters",
            description: "List all available workspace adapters for the current project.",
          }),
        ),
        HttpApiEndpoint.get("list", WorkspacePaths.list, {
          success: described(Schema.Array(Workspace.Info), "Workspaces"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.list",
            summary: "List workspaces",
            description: "List all workspaces.",
          }),
        ),
        HttpApiEndpoint.post("create", WorkspacePaths.list, {
          payload: CreatePayload,
          success: described(Workspace.Info, "Workspace created"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.create",
            summary: "Create workspace",
            description: "Create a workspace for the current project.",
          }),
        ),
        HttpApiEndpoint.get("status", WorkspacePaths.status, {
          success: described(Schema.Array(Workspace.ConnectionStatus), "Workspace status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.status",
            summary: "Workspace status",
            description: "Get connection status for workspaces in the current project.",
          }),
        ),
        HttpApiEndpoint.delete("remove", WorkspacePaths.remove, {
          params: { id: Workspace.Info.fields.id },
          success: described(Schema.UndefinedOr(Workspace.Info), "Workspace removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.remove",
            summary: "Remove workspace",
            description: "Remove an existing workspace.",
          }),
        ),
        HttpApiEndpoint.post("warp", WorkspacePaths.warp, {
          payload: WarpPayload,
          success: described(HttpApiSchema.NoContent, "Session warped"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.warp",
            summary: "Warp session into workspace",
            description: "Move a session's sync history into the target workspace, or detach it to the local project.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Experimental HttpApi workspace routes." }))
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
