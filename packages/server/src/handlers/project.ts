import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProjectNotFoundError } from "@opencode-ai/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle("project.list", () => Project.Service.use((project) => project.list()))
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
    .handle("project.current", () => Location.current.pipe(Effect.map((location) => location.project))),
)
