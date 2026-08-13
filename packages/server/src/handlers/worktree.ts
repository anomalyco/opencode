import { Git } from "@opencode-ai/core/git"
import { Worktree } from "@opencode-ai/core/worktree"
import { WorktreeError } from "@opencode-ai/protocol/groups/worktree"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  Effect.gen(function* () {
    const worktrees = yield* Worktree.Service

    return handlers
      .handle("worktree.list", (ctx) => worktrees.list(ctx.params.projectID))
      .handle("worktree.create", (ctx) =>
        badRequest(worktrees.create({ ...ctx.payload, projectID: ctx.params.projectID })),
      )
      .handle("worktree.remove", (ctx) =>
        badRequest(worktrees.remove({ ...ctx.payload, projectID: ctx.params.projectID })).pipe(
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
      .handle("worktree.refresh", (ctx) =>
        badRequest(worktrees.refresh({ projectID: ctx.params.projectID })).pipe(
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
  }),
)

function badRequest<A, R>(effect: Effect.Effect<A, Worktree.Error, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new WorktreeError({
          name: "WorktreeError",
          data: {
            message: message(error),
            forceRequired: error instanceof Git.WorktreeError ? error.forceRequired : undefined,
          },
        }),
    ),
  )
}

function message(error: Worktree.Error) {
  if (error instanceof Worktree.SourceDirectoryNotFoundError)
    return error.directory
      ? `Worktree source not found: ${error.directory}`
      : `Worktree source not found for project: ${error.projectID}`
  if (error instanceof Worktree.DestinationExistsError) return `Worktree destination already exists: ${error.directory}`
  if (error instanceof Worktree.DirectoryUnavailableError) return `Worktree directory unavailable: ${error.directory}`
  if (error instanceof Worktree.InvalidDirectoryError) return `Invalid worktree directory: ${error.directory}`
  if (error instanceof Worktree.StrategyUnavailableError) return `Worktree strategy unavailable: ${error.strategy}`
  return error.message
}
