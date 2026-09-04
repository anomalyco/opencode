import { Project } from "@opencode-ai/schema/project"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const root = "/api/worktree"

export class WorktreeError extends Schema.Error<WorktreeError>("WorktreeError")(
  {
    name: Schema.Literal("WorktreeError"),
    data: Schema.Struct({
      message: Schema.String,
      forceRequired: Schema.optional(Schema.Boolean),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const WorktreeGroup = HttpApiGroup.make("server.worktree")
  .add(
    HttpApiEndpoint.get("worktree.list", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      success: Worktree.List,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.worktree.list",
        summary: "List worktrees",
        description: "List known local worktrees for a project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("worktree.create", root, {
      query: LocationQuery,
      payload: Worktree.CreateInput,
      success: Worktree.Info,
      error: WorktreeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.create",
          summary: "Create worktree",
          description:
            "Create a local worktree using the location's registered strategy and directory defaults, then run the project's setup script.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("worktree.remove", root, {
      query: LocationQuery,
      payload: Worktree.RemoveInput,
      success: HttpApiSchema.NoContent,
      error: WorktreeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.remove",
          summary: "Remove worktree",
          description: "Remove a managed worktree from the requested location's project using its recorded strategy.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("worktree.refresh", `${root}/refresh`, {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: WorktreeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.refresh",
          summary: "Refresh worktrees",
          description: "Discover worktrees from the requested location and reconcile the shared project inventory.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "worktree", description: "Project worktree management routes." }))
