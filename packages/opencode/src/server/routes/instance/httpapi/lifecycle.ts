import type { WorkspaceID } from "@/control-plane/schema"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceRef } from "@/effect/instance-ref"
import { Instance, type InstanceContext } from "@/project/instance"
import { Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpServerRequest } from "effect/unstable/http"

type MarkedInstance = {
  ctx: InstanceContext
  workspaceID?: WorkspaceID
}

const disposeAfterResponse = new WeakMap<object, MarkedInstance>()

const mark = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    return { ctx, workspaceID: yield* WorkspaceRef }
  })

const restoreMarked = <A>(marked: MarkedInstance, fn: () => A) =>
  Effect.promise(() =>
    WorkspaceContext.provide({
      workspaceID: marked.workspaceID,
      fn: () => Instance.restore(marked.ctx, fn),
    }),
  )

export const markInstanceForDisposal = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    const marked = yield* mark(ctx)
    return yield* HttpEffect.appendPreResponseHandler((request, response) =>
      Effect.sync(() => {
        disposeAfterResponse.set(request.source, marked)
        return response
      }),
    )
  })

export const markInstanceForReload = (ctx: InstanceContext, next: Parameters<typeof Instance.reload>[0]) =>
  Effect.gen(function* () {
    const marked = yield* mark(ctx)
    return yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.as(Effect.uninterruptible(restoreMarked(marked, () => Instance.reload(next))), response),
    )
  })

export const disposeMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest
    const marked = disposeAfterResponse.get(request.source)
    if (!marked) return response
    disposeAfterResponse.delete(request.source)
    yield* Effect.uninterruptible(restoreMarked(marked, () => Instance.dispose()))
    return response
  })
