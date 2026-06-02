import {
  UiProjectView,
  type LastProjectInput,
  type OpenProjectInput,
  type ReplaceOpenProjectsInput,
  type UpdateOpenProjectInput,
} from "@/ui/project-view"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError, ProjectNotFoundError } from "../errors"

export const uiHandlers = HttpApiBuilder.group(InstanceHttpApi, "ui", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* UiProjectView.Service

    const getProjectView = Effect.fn("UiHttpApi.getProjectView")(function* () {
      return yield* svc.get()
    })

    const replaceOpenProjects = Effect.fn("UiHttpApi.replaceOpenProjects")(function* (ctx: {
      payload: ReplaceOpenProjectsInput
    }) {
      return yield* svc.replaceOpenProjects(ctx.payload).pipe(
        Effect.catchTag("UiProjectView.InvalidProjectRefError", (error) =>
          Effect.fail(new InvalidRequestError({ message: error.message })),
        ),
        Effect.catchTag("UiProjectView.ProjectNotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const openProject = Effect.fn("UiHttpApi.openProject")(function* (ctx: { payload: OpenProjectInput }) {
      return yield* svc.openProject(ctx.payload).pipe(
        Effect.catchTag("UiProjectView.InvalidProjectRefError", (error) =>
          Effect.fail(new InvalidRequestError({ message: error.message })),
        ),
        Effect.catchTag("UiProjectView.ProjectNotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const updateOpenProject = Effect.fn("UiHttpApi.updateOpenProject")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: UpdateOpenProjectInput
    }) {
      return yield* svc.updateOpenProject(ctx.params.projectID, ctx.payload).pipe(
        Effect.catchTag("UiProjectView.ProjectNotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const closeProject = Effect.fn("UiHttpApi.closeProject")(function* (ctx: { params: { projectID: ProjectV2.ID } }) {
      return yield* svc.closeProject(ctx.params.projectID)
    })

    const setLastProject = Effect.fn("UiHttpApi.setLastProject")(function* (ctx: { payload: LastProjectInput }) {
      return yield* svc.setLastProject(ctx.payload).pipe(
        Effect.catchTag("UiProjectView.InvalidProjectRefError", (error) =>
          Effect.fail(new InvalidRequestError({ message: error.message })),
        ),
        Effect.catchTag("UiProjectView.ProjectNotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    return handlers
      .handle("getProjectView", getProjectView)
      .handle("replaceOpenProjects", replaceOpenProjects)
      .handle("openProject", openProject)
      .handle("updateOpenProject", updateOpenProject)
      .handle("closeProject", closeProject)
      .handle("setLastProject", setLastProject)
  }),
)
