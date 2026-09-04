import { Git } from "@opencode-ai/core/git"
import { Worktree } from "@opencode-ai/core/worktree"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Plugin } from "@opencode-ai/core/plugin"
import { WorktreeError } from "@opencode-ai/protocol/groups/worktree"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const database = yield* Database.Service

    const run = <A>(ref: Location.Ref, action: (service: Worktree.Interface) => Effect.Effect<A, Worktree.Error>) => {
      if (ref.workspaceID) return Effect.fail(new Worktree.UnsupportedLocationError({ directory: ref.directory }))
      return Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const worktrees = yield* Worktree.Service
        yield* plugins.awaitActivation
        return yield* action(worktrees)
      }).pipe(Effect.provide(locations.get(ref)))
    }

    return handlers
      .handle("worktree.list", (ctx) =>
        Worktree.list(ctx.params.projectID).pipe(Effect.provideService(Database.Service, database)),
      )
      .handle("worktree.create", (ctx) =>
        badRequest(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            return yield* run(requestRef(request), (worktrees) =>
              worktrees.create({ ...ctx.payload, projectID: ctx.params.projectID }),
            )
          }),
        ),
      )
      .handle("worktree.remove", (ctx) =>
        badRequest(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            return yield* run(requestRef(request), (worktrees) =>
              worktrees.remove({ ...ctx.payload, projectID: ctx.params.projectID }),
            )
          }),
        ).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("worktree.refresh", (ctx) =>
        badRequest(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            return yield* run(requestRef(request), (worktrees) =>
              worktrees.refresh({ projectID: ctx.params.projectID }),
            )
          }),
        ).pipe(Effect.as(HttpApiSchema.NoContent.make())),
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
            forceRequired:
              error instanceof Git.WorktreeError || error instanceof Worktree.OperationError
                ? error.forceRequired
                : undefined,
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
  if (error instanceof Worktree.ProjectMismatchError)
    return `Worktree location belongs to project ${error.actualProjectID}, not ${error.projectID}`
  if (error instanceof Worktree.UnsupportedLocationError) return "Worktree operations only support local locations"
  return error.message
}
