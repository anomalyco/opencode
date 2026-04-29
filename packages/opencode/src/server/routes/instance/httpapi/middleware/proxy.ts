import { ProxyUtil } from "@/server/proxy-util"
import { Workspace } from "@/control-plane/workspace"
import type { WorkspaceID } from "@/control-plane/schema"
import * as Fence from "@/server/fence"
import { Effect, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"

export function sourceRequest(request: HttpServerRequest.HttpServerRequest): Request {
  if (request.source instanceof Request) return request.source
  return new Request(new URL(request.originalUrl, "http://localhost"), {
    method: request.method,
    headers: request.headers as HeadersInit,
  })
}

export function websocket(
  request: HttpServerRequest.HttpServerRequest,
  target: string | URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.scoped(
    Effect.gen(function* () {
      const source = sourceRequest(request)
      const inbound = yield* Effect.orDie(request.upgrade)
      const outbound = yield* Socket.makeWebSocket(ProxyUtil.websocketTargetURL(target), {
        protocols: ProxyUtil.websocketProtocols(source),
      }).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
      const writeInbound = yield* inbound.writer
      const writeOutbound = yield* outbound.writer

      yield* outbound
        .runRaw((message) => writeInbound(message))
        .pipe(
          Effect.catchReason("SocketError", "SocketCloseError", (reason) =>
            writeInbound(new Socket.CloseEvent(reason.code, reason.closeReason)).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.catch(() => writeInbound(new Socket.CloseEvent(1011, "proxy error")).pipe(Effect.catch(() => Effect.void))),
          Effect.orDie,
          Effect.forkScoped,
        )

      yield* inbound
        .runRaw((message) => {
          return writeOutbound(typeof message === "string" ? message : message.slice())
        })
        .pipe(
          Effect.catch(() => Effect.void),
          Effect.ensuring(writeOutbound(new Socket.CloseEvent()).pipe(Effect.catch(() => Effect.void))),
          Effect.orDie,
        )
      return HttpServerResponse.empty()
    }),
  )
}

function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function http(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  if (!Workspace.isSyncing(workspaceID)) {
    return Effect.succeed(
      new Response(`broken sync connection for workspace: ${workspaceID}`, {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    )
  }

  return Effect.gen(function* () {
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

    if (sync) yield* Effect.promise(() => Fence.wait(workspaceID, sync, req.signal))
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

export { ProxyUtil }

export * as HttpApiProxy from "./proxy"
