import { listAdaptors } from "@/control-plane/adaptors"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdaptorEntry } from "@/control-plane/types"
import * as InstanceState from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { Effect, Layer, Schema, Struct } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/experimental/workspace"
const CreatePayload = Schema.Struct(Struct.omit(Workspace.CreateInput.fields, ["projectID"])).annotate({
  identifier: "WorkspaceCreateInput",
})
const SessionRestorePayload = Schema.Struct(
  Struct.omit(Workspace.SessionRestoreInput.fields, ["workspaceID"]),
).annotate({
  identifier: "WorkspaceSessionRestoreInput",
})
const SessionRestoreResponse = Schema.Struct({
  total: Schema.Number,
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
        HttpApiEndpoint.get("list", WorkspacePaths.list, {
          success: Schema.Array(Workspace.Info),
        }).annotateMerge(
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
      .annotateMerge(
        OpenApi.annotations({
          title: "workspace",
          description: "Experimental HttpApi workspace routes.",
        }),
      )
      .middleware(Authorization),
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

    const create = Effect.fn("WorkspaceHttpApi.create")(function* (ctx: { payload: typeof CreatePayload.Type }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          Workspace.create({
            ...ctx.payload,
            projectID: instance.project.id,
          }),
        ),
      )
    })

    const status = Effect.fn("WorkspaceHttpApi.status")(function* () {
      const ids = new Set(Workspace.list((yield* InstanceState.context).project).map((item) => item.id))
      return Workspace.status().filter((item) => ids.has(item.workspaceID))
    })

    const remove = Effect.fn("WorkspaceHttpApi.remove")(function* (ctx: { params: { id: Workspace.Info["id"] } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() => Instance.restore(instance, () => Workspace.remove(ctx.params.id)))
    })

    const sessionRestore = Effect.fn("WorkspaceHttpApi.sessionRestore")(function* (ctx: {
      params: { id: Workspace.Info["id"] }
      payload: typeof SessionRestorePayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          Workspace.sessionRestore({
            workspaceID: ctx.params.id,
            sessionID: ctx.payload.sessionID,
          }),
        ),
      )
    })

    return HttpApiBuilder.group(WorkspaceApi, "workspace", (handlers) =>
      handlers
        .handle("adaptors", adaptors)
        .handle("list", list)
        .handle("create", create)
        .handle("status", status)
        .handle("remove", remove)
        .handle("sessionRestore", sessionRestore),
    )
  }),
)
