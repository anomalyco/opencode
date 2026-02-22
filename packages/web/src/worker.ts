/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono"
import { cors } from "hono/cors"

export type Env = {
  SESSIONS_API: Fetcher
  SESSIONS_REF: DurableObjectNamespace
}

export class SessionRef implements DurableObject {
  state: DurableObjectState
  env: Env
  private sessions: Map<string, WebSocket> = new Map()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.restoreConnections()
  }

  private restoreConnections() {
    const websockets = this.state.getWebSockets()
    for (const ws of websockets) {
      const attachment = ws.deserializeAttachment()
      if (attachment?.clientId) {
        this.sessions.set(attachment.clientId, ws)
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const shareId = url.pathname.split("/")[2]

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      const clientId = crypto.randomUUID()
      this.sessions.set(clientId, server)

      // Persist metadata
      server.serializeAttachment({
        clientId,
        shareId,
        connectedAt: Date.now(),
      })

      this.state.acceptWebSocket(server, ["session", shareId])

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    return new Response("Not Found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const attachment = ws.deserializeAttachment()
    const msg = JSON.parse(message)

    // Forward to sessions API via fetch
    const apiMessage = {
      clientId: attachment.clientId,
      shareId: attachment.shareId,
      message: msg,
    }

    const response = await this.env.SESSIONS_API.fetch(
      new Request("http://sessions-api/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiMessage),
      }),
    )
    console.log("[SessionRef] Forwarded message to sessions API:", response.status)
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment()
    this.sessions.delete(attachment.clientId)

    // Notify sessions API
    const response = await this.env.SESSIONS_API.fetch(
      new Request("http://sessions-api/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: attachment.clientId,
          shareId: attachment.shareId,
        }),
      }),
    )
    console.log("[SessionRef] Notified disconnect to sessions API:", response.status)
  }
}

const app = new Hono<{ Bindings: Env }>()

app.use("*", cors())

app.get("/install", async (c) => {
  const upstream = await fetch("https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/install").then(
    (r) => (r.ok ? r.text() : null),
  )
  const body = upstream
    ? upstream
        .replace(/anomalyco\/opencode/g, "manno23/opencode")
        .replace(/https:\/\/opencode\.ai\/install/g, "https://opencode.j9xym.com/install")
        .replace(/https:\/\/opencode\.ai\/docs/g, "https://opencode.j9xym.com/docs")
    : "#!/usr/bin/env bash\necho 'Install script unavailable. Visit https://github.com/manno23/opencode/releases'\nexit 1\n"
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
})

app.all("/api/*", async (c) => {
  try {
    const response = await c.env.SESSIONS_API.fetch(c.req.raw)
    return response
  } catch (error) {
    console.error(`[API] Error:`, error)
    return c.json({ error: "API unavailable" }, 503)
  }
})

app.get("/api/sessions", async (c) => {
  // Mock sessions data (will be replaced by SESSIONS_API later)
  return c.json({
    sessions: [
      {
        id: "test123",
        sessionID: "session-abc",
        createdAt: Date.now() - 86400000,
      },
    ],
  })
})

app.get("/api/share/:id", async (c) => {
  const id = c.req.param("id")
  // Mock share data (will be replaced by SESSIONS_API later)
  return c.json({
    session: {
      id,
      title: "Mock Session",
      directory: "/mock/path",
      time: { created: Date.now() - 86400000 },
    },
    messages: [
      {
        role: "user",
        parts: ["Hello, this is a test message"],
        time: { created: Date.now() - 3600000 },
      },
    ],
  })
})

app.get("/ws/:shareId", async (c) => {
  const shareId = c.req.param("shareId")

  try {
    const id = c.env.SESSIONS_REF.idFromName(shareId)
    const roomStub = c.env.SESSIONS_REF.get(id)

    const response = await roomStub.fetch(
      new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.method !== "GET" ? await c.req.text() : undefined,
      }),
    )

    return response
  } catch (error) {
    console.error(`[WebSocket] Error:`, error)
    return c.json({ error: "WebSocket failed" }, 500)
  }
})

app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/src/index.html" : c.req.path
  const viteUrl = "http://localhost:5173"

  try {
    const response = await fetch(`${viteUrl}${path}`, {
      method: c.req.method,
      headers: new Headers(c.req.raw.headers),
      body: c.req.method !== "GET" ? await c.req.text() : undefined,
    })

    if (response.status === 404 && !path.includes(".")) {
      const indexResponse = await fetch(`${viteUrl}/src/index.html`, {
        method: "GET",
        headers: new Headers(c.req.raw.headers),
      })

      if (indexResponse.ok) {
        const headers = new Headers(indexResponse.headers)
        headers.set("Content-Type", "text/html")
        headers.set("Access-Control-Allow-Origin", "*")
        return new Response(indexResponse.body, { status: 200, headers })
      }
    }

    const headers = new Headers(response.headers)
    headers.set("Access-Control-Allow-Origin", "*")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    console.log(`[Worker] Vite unavailable, build assets with: bun run build`)
    return c.json(
      {
        error: "Development server not running",
        help: ["For development: cd packages/web && vite dev", "For production: bun run build && wrangler deploy"],
      },
      503,
    )
  }
})

export default app
