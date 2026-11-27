import { Layer } from "effect"
import { Socket } from "effect/socket"
import { constructorOptions, proxy } from "./options.js"

type BunWebSocketConstructor = new (
  url: string,
  options: Socket.WebSocketClientOptions & { readonly proxy?: string },
) => globalThis.WebSocket

// Keep trust on the runtime store so NODE_EXTRA_CA_CERTS remains additive.
export const layer = Layer.succeed(Socket.WebSocketConstructor, (url, input) => {
  const config = constructorOptions(input)
  const selectedProxy = proxy(url)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Bun extends the browser constructor with handshake and network options.
  const BunWebSocket = globalThis.WebSocket as unknown as BunWebSocketConstructor
  return new BunWebSocket(url, {
    headers: config.headers,
    protocols: config.protocols,
    ...(selectedProxy ? { proxy: selectedProxy } : {}),
  })
})
