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
        project
          .update({ ...ctx.payload, projectID: ctx.params.projectID })
          .pipe(
            Effect.catchTag(
              "Project.NotFoundError",
              (error) => new ProjectNotFoundError({ projectID: error.projectID, message: "Project not found" }),
            ),
          ),
      ),
    )
    .handle("project.current", () =>
      Location.Service.use((location) =>
        Effect.succeed({
          id: location.project.id,
          directory: location.project.directory,
          canonical: location.project.canonical,
        }),
      ),
    ),
)
