import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer, Option, Ref } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { UsageLimits } from "../usage-limits.js"
import { WebSocketConstructor } from "./websocket-constructor.js"

// Bun's fetch ends a request after five quiet minutes, before provider routes' own header and chunk timeouts.
const withoutBunTimeout = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return HttpClient.transformResponse(
      client,
      Effect.provideService(FetchHttpClient.RequestInit, { timeout: false } as BunFetchRequestInit),
    )
  }),
)

/**
 * Records the `x-ratelimit-*` snapshot of every provider response into the
 * capture the current model call provided, if any. The capture stays with the
 * request that produced it, so no URL-to-provider mapping is needed.
 */
const captureRateLimits: RequestExecutor.HttpMiddleware = (request, handler) =>
  handler(request).pipe(
    Effect.tap((response) =>
      Effect.serviceOption(UsageLimits.RateLimitCapture).pipe(
        Effect.flatMap((capture) => {
          if (Option.isNone(capture)) return Effect.void
          const snapshot = RequestExecutor.rateLimitSnapshot(response.headers)
          if (snapshot === undefined) return Effect.void
          return Ref.set(capture.value.ref, Option.some(snapshot))
        }),
      ),
    ),
  )

const executorWithCapture: Layer.Layer<
  RequestExecutor.Service,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  RequestExecutor.Service,
  Effect.gen(function* () {
    const inner = yield* RequestExecutor.Service
    return RequestExecutor.Service.of({
      execute: (request, next) =>
        inner.execute(
          request,
          next === undefined
            ? captureRateLimits
            : (input, handle) => captureRateLimits(input, (forwarded) => next(forwarded, handle)),
        ),
    })
  }),
).pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(withoutBunTimeout))))

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: executorWithCapture,
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
