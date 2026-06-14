import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationMiddleware, LocationQuery, locationQueryOpenApi } from "./location"

const root = "/experimental/project/:projectID/copy"

export class ProjectCopyError extends Schema.ErrorClass<ProjectCopyError>("ProjectCopyError")(
  {
    name: Schema.Literal("ProjectCopyError"),
    data: Schema.Struct({
      message: Schema.String,
      forceRequired: Schema.optional(Schema.Boolean),
    }),
  },
  { httpApiStatus: 400 },
) {}

const CreatePayload = Schema.Struct(Struct.omit(ProjectCopy.CreateInput.fields, ["projectID", "sourceDirectory"]))
const RemovePayload = Schema.Struct(Struct.omit(ProjectCopy.RemoveInput.fields, ["projectID"]))

export const ProjectCopyGroup = HttpApiGroup.make("server.projectCopy")
  .add(
    HttpApiEndpoint.post("projectCopy.create", root, {
      params: { projectID: ProjectV2.ID },
      query: LocationQuery,
      payload: CreatePayload,
      success: ProjectCopy.Copy,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.create" })),
  )
  .add(
    HttpApiEndpoint.delete("projectCopy.remove", root, {
      params: { projectID: ProjectV2.ID },
      query: LocationQuery,
      payload: RemovePayload,
      success: HttpApiSchema.NoContent,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.remove" })),
  )
  .add(
    HttpApiEndpoint.post("projectCopy.refresh", `${root}/refresh`, {
      params: { projectID: ProjectV2.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.refresh" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "projectCopy", description: "Project copy management routes." }))
  .middleware(LocationMiddleware)
