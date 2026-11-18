// Deep imports: the @effect/platform-node barrel eagerly pulls in undici,
// ioredis, and node:sqlite, which runtimes such as workerd cannot load.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { Effect, FileSystem, Layer, Path } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { tlsFallbackFetch } from "../tls-fallback.js"
import { makeGlobalNode } from "./app-node.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
// `RequestInfo | URL`, spelled out because not every runtime declares `RequestInfo` globally.
export type Fetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>
/**
 * The fetch behind `httpClient`, AI SDK providers and remote MCP servers: `fetch` when given, so an embedder can route requests through
 * e.g. a Service Binding, otherwise the `FetchHttpClient.Fetch` in scope when the graph is built. The runtime's own fetch
 * falls back to the classical TLS handshake for hosts whose network path drops the post-quantum one.
 */
export const fetchLayer = (fetch?: Fetch) =>
  Layer.effect(
    FetchHttpClient.Fetch,
    Effect.gen(function* () {
      // Bun's `typeof fetch` adds `preconnect`, which nothing here calls.
      if (fetch) return fetch as typeof globalThis.fetch
      const ambient = yield* FetchHttpClient.Fetch
      if (ambient !== globalThis.fetch) return ambient
      const log = Effect.runForkWith(yield* Effect.context())
      return tlsFallbackFetch({
        onFallback: (origin) =>
          log(
            Effect.logWarning(
              "The network drops the post-quantum TLS handshake to this host; using the classical handshake",
            ).pipe(Effect.annotateLogs({ origin })),
          ),
      }) as typeof globalThis.fetch
    }),
  )
export const httpFetch = makeGlobalNode({ service: FetchHttpClient.Fetch, layer: fetchLayer(), deps: [] })
// Provided per request, so a caller's context can't swap `httpFetch` for another fetch.
export const httpClient = makeGlobalNode({
  service: HttpClient.HttpClient,
  layer: Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const fetch = yield* FetchHttpClient.Fetch
      const client = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
      return HttpClient.transformResponse(client, Effect.provideService(FetchHttpClient.Fetch, fetch))
    }),
  ),
  deps: [httpFetch],
})

export * as LayerNodePlatform from "./app-node-platform.js"
