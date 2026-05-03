import { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import * as Log from "@opencode-ai/core/util/log"
import * as Fence from "./shared/fence"
import type { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"
import { AppRuntime } from "@/effect/app-runtime"
import { ProxyUtil } from "./proxy-util"
import { Effect, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"

type Msg = string | ArrayBuffer | Uint8Array

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
          remote = new WebSocket(url, ProxyUtil.websocketProtocols(c.req.raw))
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

const log = Log.create({ service: "server-proxy" })

function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function httpEffect(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  return Effect.gen(function* () {
    const syncing = yield* Workspace.Service.use((workspace) => workspace.isSyncing(workspaceID))
    if (!syncing) {
      return new Response(`broken sync connection for workspace: ${workspaceID}`, {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      })
    }

    const response = yield* HttpClient.execute(
      HttpClientRequest.make(req.method as never)(url, {
        headers: ProxyUtil.headers(req, extra),
        body:
          req.method === "GET" || req.method === "HEAD"
            ? HttpBody.empty
            : HttpBody.raw(req.body, {
                contentType: req.headers.get("content-type") ?? undefined,
                contentLength: req.headers.get("content-length")
                  ? Number(req.headers.get("content-length"))
                  : undefined,
              }),
      }),
    )
    const next = new Headers(response.headers as HeadersInit)
    const sync = Fence.parse(next)
    next.delete("content-encoding")
    next.delete("content-length")

    if (sync) yield* Fence.waitEffect(workspaceID, sync, req.signal)
    const body = yield* Stream.toReadableStreamEffect(response.stream.pipe(Stream.catchCause(() => Stream.empty)))
    return new Response(body, {
      status: response.status,
      statusText: statusText(response),
      headers: next,
    })
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catch(() => Effect.succeed(new Response(null, { status: 500 }))),
  )
}

export function http(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  return AppRuntime.runPromise(httpEffect(url, extra, req, workspaceID))
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
  next.set("x-opencode-proxy-url", ProxyUtil.websocketTargetURL(target))
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
