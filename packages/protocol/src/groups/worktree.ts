import { Project } from "@opencode-ai/schema/project"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const root = "/api/worktree/:projectID"

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

const CreatePayload = Schema.Struct(Struct.omit(Worktree.CreateInput.fields, ["projectID"]))
const RemovePayload = Schema.Struct(Struct.omit(Worktree.RemoveInput.fields, ["projectID"]))

export const WorktreeGroup = HttpApiGroup.make("server.worktree")
  .add(
    HttpApiEndpoint.get("worktree.list", root, {
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
      params: { projectID: Project.ID },
      query: LocationQuery,
      payload: CreatePayload,
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
      params: { projectID: Project.ID },
      query: LocationQuery,
      payload: RemovePayload,
      success: HttpApiSchema.NoContent,
      error: WorktreeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.remove",
          summary: "Remove worktree",
          description: "Remove a managed worktree from a project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("worktree.refresh", `${root}/refresh`, {
      params: { projectID: Project.ID },
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
