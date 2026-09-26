import { Vcs } from "@opencode/core/vcs"
import { Project } from "@opencode/core/project"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    const project = yield* Project.Service
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle("vcs.init", () =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const directory = location.project.directory
          yield* project.initializeGit(directory).pipe(
            Effect.mapError((error) => {
              if (error.kind === "missing")
                return new InvalidRequestError({ message: "Project directory does not exist", field: "location" })
              if (error.kind === "conflict")
                return new ConflictError({ message: "Project already has version control", resource: directory })
              return new ServiceUnavailableError({ service: "git", message: "Git initialization failed" })
            }),
          )
          yield* locations.invalidate(
            Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("vcs.get", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.info()
          }),
        ),
      )
      .handle("vcs.base", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs
              .base()
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.branch.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.branches({ search: ctx.query.search, limit: Math.min(ctx.query.limit ?? 50, 100) })
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs
              .diff(ctx.query.mode, { context: ctx.query.context, base: ctx.query.base })
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
  }),
)
