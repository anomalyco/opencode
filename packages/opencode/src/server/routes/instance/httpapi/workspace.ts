import { listAdaptors } from "@/control-plane/adaptors"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdaptorEntry } from "@/control-plane/types"
import * as InstanceState from "@/effect/instance-state"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/experimental/workspace"
export const WorkspacePaths = {
  adaptors: `${root}/adaptor`,
  list: root,
  status: `${root}/status`,
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
        HttpApiEndpoint.get("list", WorkspacePaths.list, {
          success: Schema.Array(Workspace.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.workspace.list",
            summary: "List workspaces",
            description: "List all workspaces.",
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
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "workspace",
          description: "Experimental HttpApi workspace routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const workspaceHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const adaptors = Effect.fn("WorkspaceHttpApi.adaptors")(function* () {
      const ctx = yield* InstanceState.context
      return yield* Effect.promise(() => listAdaptors(ctx.project.id))
    })

    const list = Effect.fn("WorkspaceHttpApi.list")(function* () {
      return Workspace.list((yield* InstanceState.context).project)
    })

    const status = Effect.fn("WorkspaceHttpApi.status")(function* () {
      const ids = new Set(Workspace.list((yield* InstanceState.context).project).map((item) => item.id))
      return Workspace.status().filter((item) => ids.has(item.workspaceID))
    })

    return HttpApiBuilder.group(WorkspaceApi, "workspace", (handlers) =>
      handlers.handle("adaptors", adaptors).handle("list", list).handle("status", status),
    )
  }),
)
