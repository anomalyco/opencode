import { ProjectV2 } from "@opencode-ai/core/project"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

export const GenerateNamePayload = Schema.Struct({
  context: Schema.optional(Schema.String),
})

export const ProjectCopyApi = HttpApi.make("projectCopyName").add(
  HttpApiGroup.make("projectCopyName")
    .add(
      HttpApiEndpoint.post("generateName", "/experimental/project/:projectID/copy/generate-name", {
        params: { projectID: ProjectV2.ID },
        query: WorkspaceRoutingQuery,
        payload: GenerateNamePayload,
        success: Schema.Struct({ name: Schema.String }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.projectCopy.generateName",
          summary: "Generate project copy name",
          description: "Generate a short name for a project copy from task context.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "projectCopy", description: "Project copy naming routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
