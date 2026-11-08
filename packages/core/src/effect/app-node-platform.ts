import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
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

// Presents the model's client certificate (provider `settings.tls`) on its HTTPS requests. The TLS handshake only
// sends it to servers that request one.
const withClientCertificate = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return HttpClient.transform(client, (effect, request) =>
      Effect.gen(function* () {
        const tls = yield* RequestExecutor.CurrentTls
        if (!tls || !request.url.startsWith("https:")) return yield* effect
        const init: BunFetchRequestInit = Option.getOrElse(
          yield* Effect.serviceOption(FetchHttpClient.RequestInit),
          () => ({}),
        )
        return yield* effect.pipe(
          Effect.provideService(FetchHttpClient.RequestInit, {
            ...init,
            tls: { ...init.tls, ...tls },
            // A followed redirect keeps the TLS options, so it would present the certificate to whatever host the
            // server names.
            redirect: init.redirect === "manual" ? "manual" : "error",
          } as BunFetchRequestInit),
        )
      }),
    )
  }),
)

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer.pipe(Layer.provide(withoutBunTimeout), Layer.provide(withClientCertificate)),
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
