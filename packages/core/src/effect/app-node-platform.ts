import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Document } from "@opencode/schema/config"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http"
import { Socket } from "effect/socket"
import os from "os"
import path from "path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { FSUtil } from "@opencode/util/fs-util"
import { Config } from "../config.js"
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

// Presents `network.client_certificate` on HTTPS model requests from a Location whose config sets one. The TLS
// handshake only sends it to servers that request a client certificate.
const withClientCertificate = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const client = yield* HttpClient.HttpClient
    return HttpClient.transform(client, (effect, request) =>
      Effect.gen(function* () {
        if (!request.url.startsWith("https:")) return yield* effect
        const config = yield* Effect.serviceOption(Config.Service)
        if (Option.isNone(config)) return yield* effect
        const source = (yield* config.value.entries()).findLast(
          (entry): entry is Document =>
            entry instanceof Document && entry.info.network?.client_certificate !== undefined,
        )
        const certificate = source?.info.network?.client_certificate
        if (!source || !certificate) return yield* effect
        const resolve = (file: string) =>
          file.startsWith("~/")
            ? path.join(os.homedir(), file.slice(2))
            : path.resolve(source.path ? path.dirname(source.path) : "", file)
        const tls = yield* Effect.all({
          cert: fs.readFileString(resolve(certificate.cert)),
          key: fs.readFileString(resolve(certificate.key)),
        }).pipe(
          Effect.mapError(
            (error) =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  description: `Could not read the configured client certificate: ${error.message}`,
                }),
              }),
          ),
        )
        const init: BunFetchRequestInit = Option.getOrElse(
          yield* Effect.serviceOption(FetchHttpClient.RequestInit),
          () => ({}),
        )
        return yield* effect.pipe(
          Effect.provideService(FetchHttpClient.RequestInit, {
            ...init,
            tls: { ...init.tls, ...tls, passphrase: certificate.passphrase },
            // A followed redirect keeps the same TLS options, so it would present the certificate to whatever host the
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
  deps: [httpClient, FSUtil.node],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
