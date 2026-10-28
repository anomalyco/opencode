import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { ProjectNotFoundError } from "@opencode/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return handlers
      .handle("project.list", (ctx) => Project.Service.use((project) => project.list(ctx.query)))
      .handle("project.update", (ctx) =>
        Project.Service.use((project) =>
          project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
            Effect.mapError(
              () =>
                new ProjectNotFoundError({
                  projectID: ctx.params.projectID,
                  message: `Project not found: ${ctx.params.projectID}`,
                }),
            ),
          ),
        ),
      )
      .handle("project.remove", (ctx) =>
        Effect.gen(function* () {
          // Graceful session teardown first: interrupt, release blobs, clear each event stream.
          yield* session.removeProject(ctx.params.projectID)
          yield* Project.Service.use((project) =>
            project.remove(ctx.params.projectID).pipe(
              Effect.mapError(
                () =>
                  new ProjectNotFoundError({
                    projectID: ctx.params.projectID,
                    message: `Project not found: ${ctx.params.projectID}`,
                  }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
