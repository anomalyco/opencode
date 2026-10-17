import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { withoutRuntimeTimeouts } from "#runtime-fetch"
import { WebSocketConstructor } from "./websocket-constructor.js"

// Provider routes enforce their own header, chunk, and total timeouts; the runtime fetch must not end requests first.
const withoutFetchTimeouts = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return HttpClient.transformResponse(client, (effect) =>
      Effect.flatMap(FetchHttpClient.Fetch, (fetch) =>
        Effect.provideService(effect, FetchHttpClient.Fetch, withoutRuntimeTimeouts(fetch)),
      ),
    )
  }),
)

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer.pipe(Layer.provide(withoutFetchTimeouts)),
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
