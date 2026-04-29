import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdaptorEntry } from "@/control-plane/types"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../auth"
import { InstanceContextMiddleware } from "../instance-context"

const root = "/experimental/workspace"
export const CreatePayload = Schema.Struct(Struct.omit(Workspace.CreateInput.fields, ["projectID"])).annotate({
  identifier: "WorkspaceCreateInput",
})
export const SessionRestorePayload = Schema.Struct(
  Struct.omit(Workspace.SessionRestoreInput.fields, ["workspaceID"]),
).annotate({
  identifier: "WorkspaceSessionRestoreInput",
})
export const SessionRestoreResponse = Schema.Struct({
  total: Schema.Finite,
}).annotate({ identifier: "WorkspaceSessionRestoreResponse" })

export const WorkspacePaths = {
  adaptors: `${root}/adaptor`,
  list: root,
  status: `${root}/status`,
  remove: `${root}/:id`,
  sessionRestore: `${root}/:id/session-restore`,
} as const

export const WorkspaceApi = HttpApi.make("workspace")
  .add(
    HttpApiGroup.make("workspace")
      .add(
        HttpApiEndpoint.get("adaptors", WorkspacePaths.adaptors, {
          success: Schema.Array(WorkspaceAdaptorEntry),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.adaptor.list",
            summary: "List workspace adaptors",
            description: "List all available workspace adaptors for the current project.",
          }),
        ),
        HttpApiEndpoint.get("list", WorkspacePaths.list, { success: Schema.Array(Workspace.Info) }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.list",
            summary: "List workspaces",
            description: "List all workspaces.",
          }),
        ),
        HttpApiEndpoint.post("create", WorkspacePaths.list, {
          payload: CreatePayload,
          success: Workspace.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.create",
            summary: "Create workspace",
            description: "Create a workspace for the current project.",
          }),
        ),
        HttpApiEndpoint.get("status", WorkspacePaths.status, {
          success: Schema.Array(Workspace.ConnectionStatus),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.status",
            summary: "Workspace status",
            description: "Get connection status for workspaces in the current project.",
          }),
        ),
        HttpApiEndpoint.delete("remove", WorkspacePaths.remove, {
          params: { id: Workspace.Info.fields.id },
          success: Schema.UndefinedOr(Workspace.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.remove",
            summary: "Remove workspace",
            description: "Remove an existing workspace.",
          }),
        ),
        HttpApiEndpoint.post("sessionRestore", WorkspacePaths.sessionRestore, {
          params: { id: Workspace.Info.fields.id },
          payload: SessionRestorePayload,
          success: SessionRestoreResponse,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.sessionRestore",
            summary: "Restore session into workspace",
            description: "Replay a session's sync events into the target workspace in batches.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Experimental HttpApi workspace routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
