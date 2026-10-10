import { Vcs } from "@opencode/core/vcs"
import { Project } from "@opencode/core/project"
import { Worktree } from "@opencode/core/worktree"
import { Bus } from "@opencode/core/bus"
import { Plugin } from "@opencode/core/plugin"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { VcsInitNotSupportedError } from "@opencode/protocol/groups/vcs"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

// A cold location registers its VCS provider during plugin activation.
const service = Plugin.awaitActivation.pipe(Effect.andThen(Vcs.Service))

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bus = yield* Bus.Service
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle("vcs.init", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          const directory = location.project.directory
          const providerID = ctx.query.provider ?? "git"
          const vcs = yield* service
          yield* vcs.initialize(providerID).pipe(
            Effect.mapError((error) => {
              if (error.kind === "missing")
                return new InvalidRequestError({ message: "Project directory does not exist", field: "location" })
              if (error.kind === "conflict")
                return new ConflictError({ message: "Project already has version control", resource: directory })
              if (error.kind === "unknown")
                return new InvalidRequestError({
                  message: "Unknown VCS provider",
                  field: "provider",
                })
              if (error.kind === "unsupported")
                return new VcsInitNotSupportedError({
                  providerID,
                  message: "VCS provider does not support initialization",
                })
              return new ServiceUnavailableError({ service: providerID, message: "VCS initialization failed" })
            }),
          )
          const resolved = yield* project.resolve(directory)
          if (!resolved.vcs)
            return yield* new ServiceUnavailableError({ service: providerID, message: "VCS initialization failed" })
          yield* locations.invalidate(
            Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          )
          yield* bus.publish(Worktree.Event.Updated, { projectID: resolved.id })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("vcs.get", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.info()
          }),
        ),
      )
      .handle("vcs.base", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs
              .base()
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.branch.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.branches({ search: ctx.query.search, limit: Math.min(ctx.query.limit ?? 50, 100) })
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs
              .diff(ctx.query.mode, { context: ctx.query.context, base: ctx.query.base })
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
  }),
)
