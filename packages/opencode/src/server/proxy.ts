import type { Target } from "@/control-plane/types"
import { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"

const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

type Msg = string | ArrayBuffer | Uint8Array

function headers(req: Request, extra?: HeadersInit) {
  const out = new Headers(req.headers)
  for (const key of hop) out.delete(key)
  out.delete("x-opencode-directory")
  out.delete("x-opencode-workspace")
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

function protocols(req: Request) {
  const value = req.headers.get("sec-websocket-protocol")
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function socket(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}

function send(ws: { send(data: string | ArrayBuffer | Uint8Array): void }, data: any) {
  if (data instanceof Blob) {
    return data.arrayBuffer().then((x) => ws.send(x))
  }
  return ws.send(data)
}

const app = (upgrade: UpgradeWebSocket) =>
  new Hono().get(
    "/__workspace_ws",
    upgrade((c) => {
      const url = c.req.header("x-opencode-proxy-url")
      const queue: Msg[] = []
      let remote: WebSocket | undefined
      return {
        onOpen(_, ws) {
          if (!url) {
            ws.close(1011, "missing proxy target")
            return
          }
          remote = new WebSocket(url, protocols(c.req.raw))
          remote.binaryType = "arraybuffer"
          remote.onopen = () => {
            for (const item of queue) remote?.send(item)
            queue.length = 0
          }
          remote.onmessage = (event) => {
            send(ws, event.data)
          }
          remote.onerror = () => {
            ws.close(1011, "proxy error")
          }
          remote.onclose = (event) => {
            ws.close(event.code, event.reason)
          }
        },
        onMessage(event) {
          const data = event.data
          if (typeof data !== "string" && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) return
          if (remote?.readyState === WebSocket.OPEN) {
            remote.send(data)
            return
          }
          queue.push(data)
        },
        onClose(event) {
          remote?.close(event.code, event.reason)
        },
      }
    }),
  )

export namespace ServerProxy {
  export function http(target: Extract<Target, { type: "remote" }>, req: Request) {
    return fetch(
      new Request(target.url, {
        method: req.method,
        headers: headers(req, target.headers),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        redirect: "manual",
        signal: req.signal,
      }),
    )
  }

  export function websocket(
    upgrade: UpgradeWebSocket,
    target: Extract<Target, { type: "remote" }>,
    req: Request,
    env: unknown,
  ) {
    const url = new URL(req.url)
    url.pathname = "/__workspace_ws"
    url.search = ""
    const next = new Headers(req.headers)
    next.set("x-opencode-proxy-url", socket(target.url))
    return app(upgrade).fetch(
      new Request(url, {
        method: req.method,
        headers: next,
        signal: req.signal,
      }),
      env as never,
    )
  }
}
