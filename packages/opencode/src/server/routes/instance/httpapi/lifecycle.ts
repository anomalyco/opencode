import { Instance, type InstanceContext } from "@/project/instance"
import { Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpServerRequest } from "effect/unstable/http"

const disposeAfterResponse = new WeakMap<object, InstanceContext>()
const reloadAfterResponse = new WeakMap<object, InstanceContext & { next: Parameters<typeof Instance.reload>[0] }>()

export const markInstanceForDisposal = (ctx: InstanceContext) =>
  HttpEffect.appendPreResponseHandler((request, response) =>
    Effect.sync(() => {
      disposeAfterResponse.set(request.source, ctx)
      return response
    }),
  )

export const markInstanceForReload = (ctx: InstanceContext, next: Parameters<typeof Instance.reload>[0]) =>
  HttpEffect.appendPreResponseHandler((request, response) =>
    Effect.sync(() => {
      reloadAfterResponse.set(request.source, { ...ctx, next })
      return response
    }),
  )

export const disposeMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest
    const reload = reloadAfterResponse.get(request.source)
    if (reload) {
      reloadAfterResponse.delete(request.source)
      yield* Effect.promise(() => Instance.restore(reload, () => Instance.reload(reload.next)))
      return response
    }

    const ctx = disposeAfterResponse.get(request.source)
    if (!ctx) return response
    disposeAfterResponse.delete(request.source)
    yield* Effect.promise(() => Instance.restore(ctx, () => Instance.dispose()))
    return response
  })
