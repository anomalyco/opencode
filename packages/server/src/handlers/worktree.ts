import { Git } from "@opencode/core/git"
import { Worktree } from "@opencode/core/worktree"
import { Project } from "@opencode/core/project"
import { ProjectNotFoundError } from "@opencode/protocol/errors"
import { WorktreeError } from "@opencode/protocol/groups/worktree"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  Effect.gen(function* () {
    const worktrees = yield* Worktree.Service
    return handlers
      .handle("worktree.list", (ctx) =>
        worktrees.list(ctx.query).pipe(Effect.catchTag("Project.NotFoundError", missingProject)),
      )
      .handle("worktree.create", (ctx) => worktrees.create(ctx.payload).pipe(badRequest))
      .handle("worktree.remove", (ctx) =>
        worktrees.remove(ctx.payload).pipe(badRequest, Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("worktree.refresh", (ctx) =>
        worktrees.refresh(ctx.payload).pipe(badRequest, Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)

function badRequest<A, R>(effect: Effect.Effect<A, Worktree.Error, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", missingProject),
    Effect.mapError((error) =>
      error instanceof ProjectNotFoundError
        ? error
        : new WorktreeError({
            name: "WorktreeError",
            data: {
              message: message(error),
              forceRequired:
                error instanceof Git.WorktreeError || error instanceof Worktree.OperationError
                  ? error.forceRequired
                  : undefined,
            },
          }),
    ),
  )
}

function missingProject(error: Project.NotFoundError) {
  return Effect.fail(
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` }),
  )
}

function message(error: Exclude<Worktree.Error, Project.NotFoundError>) {
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
