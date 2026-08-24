import { Workspace } from "@opencode-ai/schema/workspace"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { UnknownError } from "../errors.js"

export const WorkspaceGroup = HttpApiGroup.make("server.workspace")
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
