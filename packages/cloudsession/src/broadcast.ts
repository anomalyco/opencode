import { DurableObject } from "./durable-object.ts"

type Env = {
  // The DO doesn't need any bindings
}

export class SessionBroadcast extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }
  override async fetch(request: Request) {
    const upgrade = request.headers.get("Upgrade")
    const connection = request.headers.get("Connection")
    if (
      !upgrade ||
      upgrade.toLowerCase() !== "websocket" ||
      !connection ||
      !connection.toLowerCase().includes("upgrade")
    ) {
      return new Response("Expected WebSocket upgrade", { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    if (server) {
      this.ctx.acceptWebSocket(server)
    }
    return new Response(null, { status: 101, webSocket: client })
  }
  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // Heartbeat or message handling could go here
  }
  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string) {
    // WebSocket already closing; this is a notification callback
  }
  override async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error)
    ws.close(1011, "Internal error")
  }
  async broadcast(data: unknown) {
    const payload = JSON.stringify(data)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch (err) {
        console.error("Failed to send to WebSocket:", err)
      }
    }
  }
}
