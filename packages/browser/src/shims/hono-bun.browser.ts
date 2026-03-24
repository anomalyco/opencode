// Stub for hono/bun (WebSocket support)
export function websocket() {
  return null
}

export function upgradeWebSocket(handler: unknown) {
  return handler
}

export const createBunWebSocket = () => ({
  upgradeWebSocket: () => ({}),
  websocket: {},
})
