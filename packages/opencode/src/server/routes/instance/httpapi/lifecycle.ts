import { Instance, type InstanceContext } from "@/project/instance"
import { Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpServerRequest } from "effect/unstable/http"

const disposeAfterResponse = new WeakMap<object, InstanceContext>()

export const markInstanceForDisposal = (ctx: InstanceContext) =>
  HttpEffect.appendPreResponseHandler((request, response) =>
    Effect.sync(() => {
      disposeAfterResponse.set(request.source, ctx)
      return response
    }),
  )

export const markInstanceForReload = (ctx: InstanceContext, next: Parameters<typeof Instance.reload>[0]) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.as(
      Effect.uninterruptible(Effect.promise(() => Instance.restore(ctx, () => Instance.reload(next)))),
      response,
    ),
  )

export const disposeMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest
    const ctx = disposeAfterResponse.get(request.source)
    if (!ctx) return response
    disposeAfterResponse.delete(request.source)
    yield* Effect.uninterruptible(Effect.promise(() => Instance.restore(ctx, () => Instance.dispose())))
    return response
  })
