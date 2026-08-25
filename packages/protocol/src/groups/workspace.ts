import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, ProviderNotFoundError, UnknownError } from "../errors.js"

export const WorkspaceGroup = HttpApiGroup.make("server.workspace")
  .add(
    HttpApiEndpoint.post("workspace.create", "/api/workspace", {
      payload: Schema.Struct({
        id: Workspace.ID.pipe(Schema.optional),
        provider: Schema.String,
      }),
      success: Schema.Struct({ data: Workspace.ID }),
      error: [ConflictError, ProviderNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.create",
        summary: "Create workspace",
        description:
          "Create a logical workspace. A caller-supplied ID is idempotent when retried with the same provider; reusing it with another provider returns a conflict.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("workspace.destroy", "/api/workspace/:workspaceID", {
      params: { workspaceID: Workspace.ID },
      success: Workspace.DestroyResult,
      error: UnknownError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workspace.destroy",
        summary: "Destroy workspace",
        description:
          "Make a workspace not exist. This operation is idempotent: an already-missing workspace succeeds with `destroyed: false`, while a workspace removed by this request returns `destroyed: true`.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Workspace lifecycle routes." }))
