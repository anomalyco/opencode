import { Project } from "@opencode-ai/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const root = "/api/project"

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", root, {
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.list",
        summary: "List projects",
        description: "List known projects.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.current", `${root}/current`, {
      query: LocationQuery,
      success: Project.Current,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.project.current",
          summary: "Get current project",
          description: "Resolve the project for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("project.directories", `${root}/:projectID/directories`, {
      params: { projectID: Project.ID },
      query: LocationQuery,
      success: Project.Directories,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.project.directories",
          summary: "List project directories",
          description: "List known local absolute directories for a project.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Location-scoped project routes.",
    }),
  )
