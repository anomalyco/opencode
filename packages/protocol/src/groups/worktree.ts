import { Project } from "@opencode-ai/schema/project"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

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
      payload: CreatePayload,
      success: Worktree.Info,
      error: WorktreeError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.worktree.create",
        summary: "Create worktree",
        description: "Create a worktree for a project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("worktree.remove", root, {
      params: { projectID: Project.ID },
      payload: RemovePayload,
      success: HttpApiSchema.NoContent,
      error: WorktreeError,
    }).annotateMerge(
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
      success: HttpApiSchema.NoContent,
      error: WorktreeError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.worktree.refresh",
        summary: "Refresh worktrees",
        description: "Reconcile stored worktrees with the project repositories.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "worktree", description: "Project worktree management routes." }))
