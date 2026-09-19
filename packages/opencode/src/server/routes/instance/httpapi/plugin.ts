import { Plugin } from "@/plugin"
import { Effect } from "effect"
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

function requestAbort(source: unknown) {
  if (source instanceof Request) return { signal: source.signal, cleanup() {} }
  if (!(source instanceof IncomingMessage)) return { signal: undefined, cleanup() {} }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (source.aborted) abort()
  source.on("aborted", abort)
  return {
    signal: controller.signal,
    cleanup() {
      source.off("aborted", abort)
    },
  }
}

function webBody(source: Readable) {
  // Node and DOM declare separate ReadableStream types despite compatible runtime objects.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>
}

function pluginRequest(request: HttpServerRequest.HttpServerRequest) {
  const abort = requestAbort(request.source)
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.source instanceof Request
        ? (request.source.body ?? undefined)
        : request.source instanceof Readable
          ? webBody(request.source)
          : undefined

  return {
    request: new Request(pluginURL(request), {
      method: request.method,
      headers: request.headers,
      body,
      signal: abort.signal,
      duplex: body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" }),
    cleanup: abort.cleanup,
  }
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
        const input = pluginRequest(request)
        yield* Effect.addFinalizer(() => Effect.sync(input.cleanup))
        const response = yield* Effect.promise(async () => {
          const result = await http.fetch(input.request)
          if (!(result instanceof Response)) throw new TypeError(`Plugin ${id} returned a non-Response`)
          return result
        })
        return HttpServerResponse.fromWeb(response)
      })

    yield* router.add("*", "/api/plugins/:pluginID/*", serve)
  }),
)
