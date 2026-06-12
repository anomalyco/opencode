import { Location } from "@opencode-ai/core/location"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { Git } from "@opencode-ai/core/git"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProjectCopyError } from "../groups/project-copy"

export const ProjectCopyHandler = HttpApiBuilder.group(Api, "server.projectCopy", (handlers) =>
  Effect.succeed(
    handlers
      .handle("projectCopy.create", (ctx) =>
        Effect.gen(function* () {
          const copies = yield* ProjectCopy.Service
          const location = yield* Location.Service
          return yield* badRequest(
            copies.create({
              ...ctx.payload,
              projectID: ctx.params.projectID,
              sourceDirectory: location.project.directory,
            }),
          )
        }),
      )
      .handle("projectCopy.remove", (ctx) =>
        ProjectCopy.Service.use((copies) =>
          badRequest(copies.remove({ ...ctx.payload, projectID: ctx.params.projectID })).pipe(
            Effect.as(HttpApiSchema.NoContent.make()),
          ),
        ),
      )
      .handle("projectCopy.refresh", (ctx) =>
        ProjectCopy.Service.use((copies) =>
          badRequest(copies.refresh({ projectID: ctx.params.projectID })).pipe(
            Effect.as(HttpApiSchema.NoContent.make()),
          ),
        ),
      ),
  ),
)

function badRequest<A, R>(effect: Effect.Effect<A, ProjectCopy.Error, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new ProjectCopyError({
          name: "ProjectCopyError",
          data: {
            message: message(error),
            forceRequired: error instanceof Git.WorktreeError ? error.forceRequired : undefined,
          },
        }),
    ),
  )
}

function message(error: ProjectCopy.Error) {
  if (error instanceof ProjectCopy.SourceDirectoryNotFoundError)
    return `Project copy source not found: ${error.directory}`
  if (error instanceof ProjectCopy.DestinationExistsError)
    return `Project copy destination already exists: ${error.directory}`
  if (error instanceof ProjectCopy.DirectoryUnavailableError)
    return `Project copy directory unavailable: ${error.directory}`
  if (error instanceof ProjectCopy.InvalidDirectoryError) return `Invalid project copy directory: ${error.directory}`
  if (error instanceof ProjectCopy.StrategyUnavailableError)
    return `Project copy strategy unavailable: ${error.strategy}`
  return error.message
}
