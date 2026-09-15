import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import type { PluginRoute, PluginRouteRequest, PluginRouteResponse } from "@opencode-ai/plugin"
import { Plugin } from "@/plugin"
import { InstanceStore } from "@/project/instance-store"

// Plugin routes are public by design: they are the inbound edge for external
// systems (chat bridges, CI, webhooks) and plugins authenticate inside their
// own handlers (for example with a shared secret). Do not wrap these in
// ServerAuth.
export const PluginRoutes = {
  prefix: "plugin",
  directoryHeader: "x-opencode-directory",
} as const

type Matched = {
  route: PluginRoute
  params: Record<string, string>
}

type RouteLayerRequirements = InstanceStore.Service | Plugin.Service

// Static catch-all for plugin-registered routes. The Effect HttpApi surface
// is built statically, so plugin routes are dispatched here at request time:
// resolve the instance for the requested directory, then look up the routes
// its plugins declared through the `routes` hook.
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const plugin = yield* Plugin.Service

    const dispatch = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
      Effect.gen(function* () {
        const url = new URL(request.url, "http://localhost")
        const segments = url.pathname.split("/").filter((segment) => segment !== "")
        const pluginID = decodeSegment(segments[1])
        if (segments[0] !== PluginRoutes.prefix || !pluginID) return unknownRoute(request)
        const remainder = "/" + segments.slice(2).map(decodeSegment).join("/").replace(/\/$/, "")
        const method = request.method.toUpperCase()
        const directory = resolveDirectory(url, request)

        return yield* store
          .provide({ directory }, dispatchInInstance(plugin, pluginID, method, remainder, request))
          .pipe(
            Effect.catchCause((cause) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: `Instance unavailable: ${Cause.pretty(cause)}` },
                  { status: 500 },
                ),
              ),
            ),
          )
      })

    yield* router.add("*", `/${PluginRoutes.prefix}/*`, (request) => dispatch(request))
  }),
)

function resolveDirectory(url: URL, request: HttpServerRequest.HttpServerRequest): string {
  const fromQuery = url.searchParams.get("directory")
  if (fromQuery) return fromQuery
  const fromHeader = request.headers[PluginRoutes.directoryHeader]
  if (typeof fromHeader === "string") return fromHeader
  return process.cwd()
}

function dispatchInInstance(
  plugin: Plugin.Interface,
  pluginID: string,
  method: string,
  remainder: string,
  request: HttpServerRequest.HttpServerRequest,
) {
  return Effect.gen(function* () {
    yield* plugin.init()
    const table = yield* plugin.routes()
    const entry = table.find((item) => item.id === pluginID)
    const matched = entry ? matchRoute(entry.routes, method, remainder) : undefined
    if (!matched) return unknownRoute(request)
    return yield* invoke(request, matched).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: `Plugin route failed: ${Cause.pretty(cause)}` },
            { status: 500 },
          ),
        ),
      ),
    )
  })
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function unknownRoute(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse {
  const url = new URL(request.url, "http://localhost")
  return HttpServerResponse.jsonUnsafe(
    { error: `Unknown plugin route: ${request.method} ${url.pathname}` },
    { status: 404 },
  )
}

function matchRoute(routes: PluginRoute[], method: string, remainder: string): Matched | undefined {
  let fallback
  for (const route of routes) {
    if (route.method.toUpperCase() !== method) continue
    const params = matchPattern(route.path, remainder)
    if (!params) continue
    if (!route.path.includes(":")) return { route, params }
    fallback ??= { route, params }
  }
  return fallback
}

function matchPattern(pattern: string, actual: string): Record<string, string> | undefined {
  const patternSegments = pattern.split("/").filter((segment) => segment !== "")
  const actualSegments = actual.split("/").filter((segment) => segment !== "")
  if (patternSegments.length !== actualSegments.length) return
  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    const expected = patternSegments[i]
    const value = actualSegments[i]
    if (expected.startsWith(":")) {
      if (!value) return
      params[expected.slice(1)] = decodeSegment(value)
      continue
    }
    if (expected !== value) return
  }
  return params
}

function invoke(
  request: HttpServerRequest.HttpServerRequest,
  matched: Matched,
) {
  const url = new URL(request.url, "http://localhost")
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams) query[key] = value
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[key] = value
  }
  const input: PluginRouteRequest = {
    method: request.method.toUpperCase(),
    path: decodeSegment(url.pathname.replace(new RegExp(`^/${PluginRoutes.prefix}/[^/]+`), "") || "/"),
    params: matched.params,
    query,
    headers,
  }
  return Effect.gen(function* () {
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
      const contentType = typeof request.headers["content-type"] === "string" ? (request.headers["content-type"] as string) : ""
      const body = contentType.includes("application/json") ? request.json : request.text
      input.body = yield* body.pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) => Effect.die(new Error(`Failed to read request body: ${Cause.pretty(cause)}`))),
      )
    }
    const result = yield* Effect.tryPromise({
      try: () => Promise.resolve(matched.route.handler(input)),
      catch: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    })
    return respond(result)
  })
}

function respond(result: PluginRouteResponse): HttpServerResponse.HttpServerResponse {
  const status = result.status ?? (result.body === undefined ? 204 : 200)
  const headers: Record<string, string> = { ...result.headers }
  if (result.body === undefined) return HttpServerResponse.empty({ status, headers })
  if (typeof result.body === "string")
    return HttpServerResponse.text(result.body, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8", ...headers },
    })
  return HttpServerResponse.jsonUnsafe(result.body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

export * as PluginRoutesDispatcher from "./plugin-routes"
