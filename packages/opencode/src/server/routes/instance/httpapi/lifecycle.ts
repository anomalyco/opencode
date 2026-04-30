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

// Disposal is requested by an endpoint handler, but must run from the outer
// server middleware after the response has been produced. The original Request
// object is the stable handoff key between those two phases.
const disposeAfterResponse = new WeakMap<object, MarkedInstance>()

const mark = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    return { ctx, workspaceID: yield* WorkspaceRef }
  })

// Instance.dispose/reload still publish events through legacy ALS helpers.
// Effect request handlers carry these values in services, so bridge them back
// into the legacy contexts only around the lifecycle operation.
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
        // The response is sent before disposeMiddleware performs the teardown.
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
