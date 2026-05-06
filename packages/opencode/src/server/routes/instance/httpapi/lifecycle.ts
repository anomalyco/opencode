import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpServerRequest } from "effect/unstable/http"

type MarkedInstance = {
  ctx: InstanceContext
  store: InstanceStore.Interface
  bridge: EffectBridge.Shape
}

// Disposal is requested by an endpoint handler, but must run from the outer
// server middleware after the response has been produced. The original Request
// object is the stable handoff key between those two phases.
const disposeAfterResponse = new WeakMap<object, MarkedInstance>()

const mark = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    return { ctx, store: yield* InstanceStore.Service, bridge: yield* EffectBridge.make() }
  })

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

export const markInstanceForReload = (ctx: InstanceContext, next: InstanceStore.LoadInput) =>
  Effect.gen(function* () {
    const marked = yield* mark(ctx)
    return yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.as(Effect.uninterruptible(marked.bridge.run(marked.store.reload(next))), response),
    )
  })

export const disposeMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest
    const marked = disposeAfterResponse.get(request.source)
    if (!marked) return response
    disposeAfterResponse.delete(request.source)
    yield* Effect.uninterruptible(marked.bridge.run(marked.store.dispose(marked.ctx)))
    return response
  })
