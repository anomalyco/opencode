import { Worktree } from "@opencode/schema/worktree"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Project } from "@opencode/schema/project"
import { ProjectNotFoundError } from "../errors.js"

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
    HttpApiEndpoint.get("worktree.list", root, {
      query: Schema.Struct({ projectID: Project.ID }),
      success: Worktree.List,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktree.list",
        summary: "List worktrees",
        description:
          "Return the project's saved worktree inventory without loading configuration or running discovery.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("worktree.create", root, {
      payload: Worktree.CreateInput,
      success: Worktree.Info,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktree.create",
        summary: "Create worktree",
        description:
          "Load the project's canonical configuration, create a local worktree using its selected strategy, then run the project's setup script.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("worktree.remove", root, {
      payload: Worktree.RemoveInput,
      success: HttpApiSchema.NoContent,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktree.remove",
        summary: "Remove worktree",
        description:
          "Load the project's canonical configuration and remove a saved worktree using its recorded strategy.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("worktree.refresh", `${root}/refresh`, {
      payload: Schema.Struct({ projectID: Project.ID }),
      success: HttpApiSchema.NoContent,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktree.refresh",
        summary: "Refresh worktrees",
        description:
          "Load the project's canonical configuration, discover worktrees across known checkout roots using all available strategies, and reconcile saved state.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "worktree", description: "Project-based worktree management routes." }))
