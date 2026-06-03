import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { CreatePayload, RemovePayload } from "../groups/project-copy"

function badRequest<A, R>(effect: Effect.Effect<A, ProjectCopy.Error, R>) {
  return effect.pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
}

export const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "projectCopy", (handlers) =>
  Effect.gen(function* () {
    const service = yield* ProjectCopy.Service

    const create = Effect.fn("ProjectCopyHttpApi.create")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: typeof CreatePayload.Type
    }) {
      return yield* badRequest(
        service.create({
          ...ctx.payload,
          projectID: ctx.params.projectID,
          sourceDirectory: AbsolutePath.make((yield* InstanceState.context).worktree),
        }),
      )
    })

    const remove = Effect.fn("ProjectCopyHttpApi.remove")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: typeof RemovePayload.Type
    }) {
      yield* badRequest(
        service.remove({
          ...ctx.payload,
          projectID: ctx.params.projectID,
        }),
      )
    })

    const refresh = Effect.fn("ProjectCopyHttpApi.refresh")(function* (ctx: { params: { projectID: ProjectV2.ID } }) {
      yield* badRequest(
        service.refresh({
          projectID: ctx.params.projectID,
        }),
      )
    })

    return handlers.handle("create", create).handle("remove", remove).handle("refresh", refresh)
  }),
)
