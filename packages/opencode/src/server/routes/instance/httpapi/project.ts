import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/project"

export const ProjectApi = HttpApi.make("project")
  .add(
    HttpApiGroup.make("project")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: Schema.Array(Project.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.list",
            summary: "List all projects",
            description: "Get a list of projects that have been opened with OpenCode.",
          }),
        ),
        HttpApiEndpoint.get("current", `${root}/current`, {
          success: Project.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.current",
            summary: "Get current project",
            description: "Retrieve the currently active project that OpenCode is working with.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "project",
          description: "Experimental HttpApi project routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const projectHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Project.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    return HttpApiBuilder.group(ProjectApi, "project", (handlers) =>
      handlers.handle("list", list).handle("current", current),
    )
  }),
).pipe(Layer.provide(Project.defaultLayer))
