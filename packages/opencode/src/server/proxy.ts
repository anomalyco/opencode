import { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { Log } from "@/util"
import * as Fence from "./fence"
import type { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"

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
  out.delete("accept-encoding")
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
            void send(ws, event.data)
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

const log = Log.Default.clone().tag("service", "server-proxy")

export async function http(
  url: string | URL,
  extra: HeadersInit | undefined,
  req: Request,
  workspaceID: WorkspaceID,
) {
  if (!Workspace.isSyncing(workspaceID)) {
    return new Response(`broken sync connection for workspace: ${workspaceID}`, {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  return fetch(
    new Request(url, {
      method: req.method,
      headers: headers(req, extra),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
      signal: req.signal,
    }),
  ).then((res) => {
    const sync = Fence.parse(res.headers)
    const next = new Headers(res.headers)
    next.delete("content-encoding")
    next.delete("content-length")

    const done = sync ? Fence.wait(workspaceID, sync, req.signal) : Promise.resolve()

    return done.then(async () => {
      console.log("proxy http response", {
        method: req.method,
        request: req.url,
        url: String(url),
        status: res.status,
        statusText: res.statusText,
      })
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: next,
      })
    })
  })
}

export function websocket(
  upgrade: UpgradeWebSocket,
  target: string | URL,
  extra: HeadersInit | undefined,
  req: Request,
  env: unknown,
) {
  const proxy = new URL(req.url)
  proxy.pathname = "/__workspace_ws"
  proxy.search = ""
  const next = new Headers(req.headers)
  next.set("x-opencode-proxy-url", socket(target))
  for (const [key, value] of new Headers(extra).entries()) {
    next.set(key, value)
  }
  log.info("proxy websocket", {
    request: req.url,
    target: String(target),
  })
  return app(upgrade).fetch(
    new Request(proxy, {
      method: req.method,
      headers: next,
      signal: req.signal,
    }),
    env as never,
  )
}

export * as ServerProxy from "./proxy"
