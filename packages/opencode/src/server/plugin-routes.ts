import type { HttpRoute } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Plugin } from "@/plugin"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"

/**
 * Matches a route pattern against a pathname.
 * Supports simple exact matching and path parameters (e.g., /webhook/:provider).
 */
function matchPath(pattern: string, pathname: string): { matched: boolean; params: Record<string, string> } {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)

  if (patternParts.length !== pathParts.length) {
    return { matched: false, params: {} }
  }

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]!
    const pathPart = pathParts[i]!

    if (patternPart.startsWith(":")) {
      // Path parameter
      params[patternPart.slice(1)] = pathPart
    } else if (patternPart !== pathPart) {
      // Exact match failed
      return { matched: false, params: {} }
    }
  }

  return { matched: true, params }
}

/**
 * Effect-based middleware that routes requests to plugin-defined HTTP handlers.
 * If a matching route is found, the plugin handler is called and the response is returned.
 * Otherwise, the request is passed to the next handler in the chain.
 */
export const pluginRoutesMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const routes = yield* plugin.getRoutes()
    const request = yield* HttpServerRequest.HttpServerRequest

    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    // Find matching route
    for (const route of routes) {
      if (route.method === method) {
        const { matched, params } = matchPath(route.path, url.pathname)
        if (matched) {
          try {
            // Convert HttpServerRequest to web Request and attach params
            const webRequest = yield* HttpServerRequest.toWeb(request)
            const requestWithParams = new Request(webRequest.url, {
              method: webRequest.method,
              headers: webRequest.headers,
              body: webRequest.body,
              // @ts-expect-error - Custom property for params
              routeParams: params,
            })
            const response = yield* Effect.promise(() => Promise.resolve(route.handler(requestWithParams)))
            return HttpServerResponse.fromWeb(response)
          } catch (error) {
            console.error(`Plugin route handler error: ${route.method} ${route.path}`, error)
            return HttpServerResponse.jsonUnsafe({ error: "Internal server error" }, { status: 500 })
          }
        }
      }
    }

    // No matching plugin route, pass to next handler
    return yield* effect
  })

/**
 * Helper to extract route params from a request.
 * Use this in plugin handlers to access path parameters.
 */
export function getRouteParams(request: Request): Record<string, string> {
  // @ts-expect-error - Custom property for params
  return request.routeParams ?? {}
}

/**
 * Composed middleware that first checks plugin routes, then applies disposal middleware.
 * Use this as the middleware parameter for HttpRouter.toWebHandler or HttpRouter.serve.
 */
export const composedMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  pluginRoutesMiddleware(disposeMiddleware(effect))
