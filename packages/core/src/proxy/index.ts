export * as Proxy from "./index"

import { Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import type { ConfigProxy } from "../config/proxy"
import { readProxyConfig } from "./config-file"
import { makeDispatcher, type ProxyDispatcher } from "./dispatcher"
import { resolve } from "./resolve"

// Chosen seam (Task 1): `FetchHttpClient.Fetch` is a `Context.Reference<typeof fetch>`
// that `FetchHttpClient.layer` reads to build the HttpClient, so the proxy-aware
// fetch below is installed there once and inherited by every consumer.

/**
 * Build a `fetch` that routes each request through the resolved proxy,
 * authenticating when the proxy challenges. When no proxy applies to a target
 * (loopback, `no_proxy`, or no proxy configured) it defers to global fetch.
 */
export function makeProxyFetch(config?: ConfigProxy.Info): typeof globalThis.fetch {
  const dispatchers = new Map<string, ProxyDispatcher>()
  let fileConfig = config
  let fileConfigLoaded = config !== undefined
  const proxyFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // Read `proxy` from opencode.json once, lazily, since the shared client is
    // global while Config is location-scoped.
    if (!fileConfigLoaded) {
      fileConfig = readProxyConfig(process.cwd())
      fileConfigLoaded = true
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const settings = resolve({ config: fileConfig, env: process.env, target: url })
    if (!settings.url) return globalThis.fetch(input, init)
    const key = `${settings.url.origin}|${settings.auth}|${settings.username ?? ""}|${settings.password ?? ""}`
    const dispatcher = dispatchers.get(key) ?? makeDispatcher(settings)
    dispatchers.set(key, dispatcher)
    return dispatcher.fetch(input, init)
  }
  // Bun's `fetch` type carries an extra `preconnect`; the runtime contract used
  // by `FetchHttpClient.Fetch` is the standard call signature.
  return proxyFetch as unknown as typeof globalThis.fetch
}

/** Proxy-aware `HttpClient` layer built from environment settings. */
export const httpClientLayer: Layer.Layer<HttpClient.HttpClient> = makeHttpClientLayer()

/** Proxy-aware `HttpClient` layer with explicit config overrides. */
export function makeHttpClientLayer(config?: ConfigProxy.Info): Layer.Layer<HttpClient.HttpClient> {
  return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, makeProxyFetch(config))))
}
