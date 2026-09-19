import { Plugin } from "@/plugin"
import { Effect, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { IncomingMessage } from "node:http"
import { Readable } from "node:stream"

function pluginURL(request: HttpServerRequest.HttpServerRequest) {
  const url =
    request.source instanceof Request
      ? new URL(request.source.url)
      : new URL(request.url, `http://${request.headers.host ?? "localhost"}`)
  const match = /^\/api\/plugins\/[^/]+(\/.*)?$/.exec(url.pathname)
  url.pathname = match?.[1] || "/"
  return url
}

function abortSignal(source: unknown) {
  if (source instanceof Request) return source.signal
  if (!(source instanceof IncomingMessage)) return undefined

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (source.aborted || (source.destroyed && !source.complete)) abort()
  source.once("aborted", abort)
  source.once("close", () => {
    if (!source.complete) abort()
  })
  return controller.signal
}

function webBody(source: Readable) {
  // Node and DOM declare separate ReadableStream types despite compatible runtime objects.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>
}

function pluginRequest(request: HttpServerRequest.HttpServerRequest) {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.source instanceof Request
        ? (request.source.body ?? undefined)
        : request.source instanceof Readable
          ? webBody(request.source)
          : undefined

  return new Request(pluginURL(request), {
    method: request.method,
    headers: request.headers,
    body,
    signal: abortSignal(request.source),
    duplex: body ? "half" : undefined,
  } as RequestInit & { duplex?: "half" })
}

function pluginResponse(response: Response) {
  const options = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }
  if (!response.body) return HttpServerResponse.empty(options)
  return HttpServerResponse.stream(
    Stream.fromReadableStream({
      evaluate: () => response.body!,
      onError: (cause) => new Error(`Plugin response stream failed: ${String(cause)}`),
    }),
    options,
  )
}

export const pluginRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const serve = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const id = route.params.pluginID
        if (!id) return HttpServerResponse.empty({ status: 404 })
        const http = yield* plugin.http(id)
        if (!http) return HttpServerResponse.empty({ status: 404 })
        const response = yield* Effect.promise(() => Promise.resolve(http.fetch(pluginRequest(request))))
        return pluginResponse(response)
      })

    yield* router.add("*", "/api/plugins/:pluginID/*", serve)
  }),
)
