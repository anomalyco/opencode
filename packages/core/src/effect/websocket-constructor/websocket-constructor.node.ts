// The platform barrel also exposes Redis and its optional native hash loader, which non-Node bundles cannot resolve.
import { WebSocket } from "@effect/platform-node/NodeWS"
import { HttpProxyAgent } from "http-proxy-agent"
import { HttpsProxyAgent } from "https-proxy-agent"
import { Layer } from "effect"
import { Socket } from "effect/socket"
import { constructorOptions, proxy } from "./options.js"

const proxyAgent = (url: string, selectedProxy: string | undefined) => {
  if (!selectedProxy) return undefined
  if (url.startsWith("wss:") || selectedProxy.startsWith("https:")) return new HttpsProxyAgent(selectedProxy)
  return new HttpProxyAgent(selectedProxy)
}

export const layer = Layer.succeed(Socket.WebSocketConstructor, (url, input) => {
  const config = constructorOptions(input)
  const native = {
    headers: config.headers,
    agent: proxyAgent(url, proxy(url)),
    // Reject redirects before headers can cross an origin boundary; the caller safely falls back to HTTP.
    followRedirects: false,
  }
  return config.protocols ? new WebSocket(url, config.protocols, native) : new WebSocket(url, native)
})
