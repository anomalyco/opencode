import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"

// Bun's fetch ends a request after five quiet minutes, before provider routes' own header and chunk timeouts.
// `transformResponse` wraps the transport closer than the caller can, so providing the timeout outright would
// replace options the caller already set — a hook's `redirect` among them. Read what is there and add to it.
export const withoutBunTimeout = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return HttpClient.transformResponse(client, (effect) =>
      Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
        Effect.provideService(effect, FetchHttpClient.RequestInit, {
          ...(Option.isSome(init) ? init.value : undefined),
          timeout: false,
        } as BunFetchRequestInit),
      ),
    )
  }),
)

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer.pipe(Layer.provide(withoutBunTimeout)),
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
