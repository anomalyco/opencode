import type { TunnelFrame } from "./protocol"

export type TunnelSender = {
  send(frame: TunnelFrame): void
  close(code?: number, reason?: string): void
}

type Pending = {
  resolveHead(status: number, headers: Record<string, string>): void
  pushChunk(data: string, encoding: "utf8" | "base64"): void
  end(): void
  error(message: string): void
}

export class TunnelBroker {
  /** Map of pairId → connected CLI sender. One tunnel per pair. */
  private tunnels = new Map<string, TunnelSender>()
  /** Map of requestId → Pending callback set so responses route back. */
  private inflight = new Map<string, Pending>()

  register(pairId: string, sender: TunnelSender) {
    // Last-write-wins: if the CLI reconnects, displace the stale socket.
    const existing = this.tunnels.get(pairId)
    if (existing && existing !== sender) {
      try {
        existing.close(4001, "replaced by reconnect")
      } catch {}
    }
    this.tunnels.set(pairId, sender)
  }

  unregister(pairId: string, sender: TunnelSender) {
    const current = this.tunnels.get(pairId)
    if (current === sender) this.tunnels.delete(pairId)
    // Fail every in-flight request for this tunnel so clients see a 502.
    for (const [id, pending] of this.inflight) {
      if (id.startsWith(pairId + ":")) {
        pending.error("tunnel closed")
        this.inflight.delete(id)
      }
    }
  }

  isConnected(pairId: string): boolean {
    return this.tunnels.has(pairId)
  }

  handleFrame(pairId: string, raw: string | ArrayBufferLike) {
    let frame: TunnelFrame
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
      frame = JSON.parse(text) as TunnelFrame
    } catch {
      return
    }
    if (frame.type === "ping") {
      this.tunnels.get(pairId)?.send({ type: "pong" })
      return
    }
    if (frame.type === "pong") return
    if (!("id" in frame)) return
    const pending = this.inflight.get(pairId + ":" + frame.id)
    if (!pending) return
    switch (frame.type) {
      case "http_response_head":
        pending.resolveHead(frame.status, frame.headers)
        return
      case "http_chunk":
        pending.pushChunk(frame.data, frame.encoding)
        return
      case "http_end":
        pending.end()
        this.inflight.delete(pairId + ":" + frame.id)
        return
      case "http_error":
        pending.error(frame.message)
        this.inflight.delete(pairId + ":" + frame.id)
        return
    }
  }

  /**
   * Forward an HTTP request down the tunnel. Returns a Response whose body is
   * a streaming ReadableStream, so SSE flows transparently through the relay.
   */
  async forward(pairId: string, request: Request): Promise<Response> {
    const sender = this.tunnels.get(pairId)
    if (!sender) return new Response("no tunnel connected", { status: 502 })

    const url = new URL(request.url)
    const path = url.pathname + url.search

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      // Hop-by-hop and auth headers stay between client and relay.
      if (lower === "host" || lower === "authorization" || lower === "connection") return
      headers[lower] = value
    })

    let body: { body: string; bodyEncoding: "utf8" | "base64" } | undefined
    if (request.method !== "GET" && request.method !== "HEAD") {
      const buf = await request.arrayBuffer()
      if (buf.byteLength > 0) {
        const bytes = new Uint8Array(buf)
        let bin = ""
        for (const byte of bytes) bin += String.fromCharCode(byte)
        body = { body: btoa(bin), bodyEncoding: "base64" }
      }
    }

    const requestId = crypto.randomUUID()
    const frame: TunnelFrame = {
      id: requestId,
      type: "http_request",
      method: request.method,
      path,
      headers,
      ...(body ?? {}),
    }

    let head: { status: number; headers: Record<string, string> } | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const broker = this
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
      cancel() {
        try {
          sender.send({ id: requestId, type: "abort" })
        } catch {}
        broker.inflight.delete(pairId + ":" + requestId)
      },
    })

    const headReady = new Promise<void>((resolve, reject) => {
      this.inflight.set(pairId + ":" + requestId, {
        resolveHead: (status, responseHeaders) => {
          head = { status, headers: responseHeaders }
          resolve()
        },
        pushChunk: (data, encoding) => {
          if (!streamController) return
          const bytes =
            encoding === "base64"
              ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
              : new TextEncoder().encode(data)
          streamController.enqueue(bytes)
        },
        end: () => {
          streamController?.close()
        },
        error: (message) => {
          if (!head) reject(new Error(message))
          else streamController?.error(new Error(message))
        },
      })
    })

    sender.send(frame)

    try {
      await headReady
    } catch (err) {
      this.inflight.delete(pairId + ":" + requestId)
      return new Response((err as Error).message, { status: 502 })
    }

    return new Response(stream, { status: head!.status, headers: head!.headers })
  }
}
