import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProjectNotFoundError } from "../errors"
import { markDirectoryForDisposal, markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = yield* ProjectV2.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const directories = Effect.fn("ProjectHttpApi.directories")((ctx: { params: { projectID: ProjectV2.ID } }) =>
      project.directories({ projectID: ctx.params.projectID }),
    )

    // The association table has a foreign key onto `project`, so an unknown id would
    // surface as a defect rather than a 404. Check first and fail with the error the
    // route already declares.
    const known = Effect.fn("ProjectHttpApi.known")(function* (projectID: ProjectV2.ID) {
      if (yield* svc.get(projectID)) return
      return yield* Effect.fail(
        new ProjectNotFoundError({ projectID, message: `Project not found: ${projectID}` }),
      )
    })

    const directoryCreate = Effect.fn("ProjectHttpApi.directoryCreate")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: { directory: AbsolutePath; strategy?: string }
    }) {
      yield* known(ctx.params.projectID)
      const result = yield* project.associate({
        projectID: ctx.params.projectID,
        directory: ctx.payload.directory,
        strategy: ctx.payload.strategy,
      })
      yield* markDirectoryForDisposal(ctx.payload.directory)
      return result
    })

    const directoryRemove = Effect.fn("ProjectHttpApi.directoryRemove")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      query: { directory: AbsolutePath }
    }) {
      yield* known(ctx.params.projectID)
      const result = yield* project.dissociate({ projectID: ctx.params.projectID, directory: ctx.query.directory })
      yield* markDirectoryForDisposal(ctx.query.directory)
      return result
    })

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("directories", directories)
      .handle("directoryCreate", directoryCreate)
      .handle("directoryRemove", directoryRemove)
  }),
)
