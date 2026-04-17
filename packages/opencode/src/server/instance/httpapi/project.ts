import { Instance } from "@/project/instance"
import { Project } from "@/project"
import { ProjectID } from "@/project/schema"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

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
        HttpApiEndpoint.post("initGit", `${root}/git/init`, {
          success: Project.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.initGit",
            summary: "Initialize git repository",
            description: "Create a git repository for the current project and return the refreshed project info.",
          }),
        ),
        HttpApiEndpoint.patch("update", `${root}/:projectID`, {
          params: { projectID: ProjectID },
          payload: Project.UpdateBody,
          success: Project.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.update",
            summary: "Update project",
            description: "Update project properties such as name, icon, and commands.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "project",
          description: "Experimental HttpApi project routes.",
        }),
      ),
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
      return Instance.project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const dir = Instance.directory
      const prev = Instance.project
      const next = yield* svc.initGit({ directory: dir, project: prev })
      if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return next
      yield* Effect.promise(() =>
        Instance.reload({
          directory: dir,
          worktree: dir,
          project: next,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
        }),
      )
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdateBody
    }) {
      return yield* svc.update({
        projectID: ctx.params.projectID,
        ...ctx.payload,
      })
    })

    return HttpApiBuilder.group(ProjectApi, "project", (handlers) =>
      handlers.handle("list", list).handle("current", current).handle("initGit", initGit).handle("update", update),
    )
  }),
).pipe(Layer.provide(Project.defaultLayer))
