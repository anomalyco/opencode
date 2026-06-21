import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProjectNotFoundError } from "../errors"
import { markInstanceForReload } from "../lifecycle"
import { SidebarState } from "../groups/project"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = yield* ProjectV2.Service
    const fs = yield* FSUtil.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const sidebarFile = path.join(Global.Path.state, "web-projects.json")
    const emptySidebar = { projects: [] }

    const sidebar = Effect.fn("ProjectHttpApi.sidebar")(function* () {
      return yield* fs.readJson(sidebarFile).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SidebarState)),
        Effect.catch(() => Effect.succeed(emptySidebar)),
      )
    })

    const updateSidebar = Effect.fn("ProjectHttpApi.updateSidebar")(function* (ctx: {
      payload: typeof SidebarState.Type
    }) {
      yield* fs.writeWithDirs(sidebarFile, JSON.stringify(ctx.payload, null, 2)).pipe(Effect.orDie)
      return ctx.payload
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

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("sidebar", sidebar)
      .handle("updateSidebar", updateSidebar)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("directories", directories)
  }),
)
