```typescript
import { DurableObject } from "cloudflare:workers"

export interface Env {
  SESSIONS_API: Fetcher
}

export class SessionRef implements DurableObject {
  private shareId: string = ""
  private secret: string | null = null

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract shareId from path /ws/:shareId
    // The worker forwards the request with the original URL
    const match = url.pathname.match(/\/ws\/([^\/]+)/)
    if (match) {
      this.shareId = match[1]
    }

    const upgradeHeader = request.headers.get("Upgrade")
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.handleSession(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async handleSession(ws: WebSocket) {
    ws.accept()

    // Ensure we have the secret
    if (!this.secret && this.shareId) {
      try {
        await this.fetchSecret()
      } catch (e) {
        console.error("Failed to fetch secret", e)
        ws.close(1011, "Failed to initialize session")
        return
      }
    }

    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string)
        await this.syncToApi(data)
      } catch (e) {
        console.error("Error processing message", e)
      }
    })
  }

  async fetchSecret() {
    // Use the Service Binding to fetch session metadata
    const response = await this.env.SESSIONS_API.fetch(`http://internal/api/share/${this.shareId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch session: ${response.status}`)
    }
    const session = (await response.json()) as any
    if (session.metadata?.secret) {
      this.secret = session.metadata.secret
    } else {
      throw new Error("Secret not found in session metadata")
    }
  }

  async syncToApi(item: any) {
    if (!this.secret) return

    // The sessions API expects { secret, data: [item] }
    // We assume 'item' is a valid sync item (e.g. { type: "message", data: ... })
    const payload = {
      secret: this.secret,
      data: [item],
    }

    const response = await this.env.SESSIONS_API.fetch(`http://internal/api/share/${this.shareId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      console.error("Failed to sync to API", response.status)
    }
  }
}
```
