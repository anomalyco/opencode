import { ProxyUtil } from "@/server/proxy-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"

function webSource(request: HttpServerRequest.HttpServerRequest): Request | undefined {
  return request.source instanceof Request ? request.source : undefined
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.raw(webSource(request)?.body ?? null, {
    contentType: request.headers["content-type"],
    contentLength: len ? Number(len) : undefined,
  })
}

export function websocket(
  request: HttpServerRequest.HttpServerRequest,
  target: string | URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Socket.WebSocketConstructor> {
  return Effect.scoped(
    Effect.gen(function* () {
      const inbound = yield* Effect.orDie(request.upgrade)
      const outbound = yield* Socket.makeWebSocket(ProxyUtil.websocketTargetURL(target), {
        protocols: ProxyUtil.websocketProtocols(request.headers),
      })
      const writeInbound = yield* inbound.writer
      const writeOutbound = yield* outbound.writer

      yield* outbound
        .runRaw((message) => writeInbound(message))
        .pipe(
          Effect.catchReason("SocketError", "SocketCloseError", (reason) =>
            writeInbound(new Socket.CloseEvent(reason.code, reason.closeReason)).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.catch(() =>
            writeInbound(new Socket.CloseEvent(1011, "proxy error")).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.forkScoped,
        )

      yield* inbound
        .runRaw((message) => {
          return writeOutbound(typeof message === "string" ? message : message.slice())
        })
        .pipe(
          Effect.catch(() => Effect.void),
          Effect.ensuring(writeOutbound(new Socket.CloseEvent()).pipe(Effect.catch(() => Effect.void))),
        )
      return HttpServerResponse.empty()
    }).pipe(Effect.orDie),
  )
}

function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function http(
  client: HttpClient.HttpClient,
  url: string | URL,
  extra: HeadersInit | undefined,
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const response = yield* client.execute(
      HttpClientRequest.make(request.method as never)(url, {
        headers: ProxyUtil.headers(request.headers as HeadersInit, extra),
        body: requestBody(request),
      }),
    )
    const headers = new Headers(response.headers as HeadersInit)
    headers.delete("content-encoding")
    headers.delete("content-length")

    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      statusText: statusText(response),
      headers,
    })
  }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 500 }))))
}

export * as HttpApiProxy from "./proxy"
