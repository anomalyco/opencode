import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

// Plain path segments only, so the value can go into HTML and URLs without escaping.
const segment = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/

/**
 * Normalize a configured base path to `/segment[/segment…]`, `""` for the root, or `undefined` when it is not a plain
 * URL path.
 */
export function normalize(input: string | undefined) {
  const trimmed = (input ?? "").trim().replace(/^\/+|\/+$/g, "")
  if (trimmed === "") return ""
  const segments = trimmed.split("/")
  if (!segments.every((part) => segment.test(part))) return
  return `/${segments.join("/")}`
}

/** The error for a base path that `normalize` rejects, naming what it accepts. */
export function invalid(input: string | undefined) {
  return new Error(`Invalid base path "${input}": use letters, digits, "-", "_", "." or "~", separated by "/"`)
}

/**
 * Serve `app` under `basePath`. The bare prefix redirects to its slash form, paths outside the prefix are not served,
 * and `app` sees each request with the prefix removed.
 */
export function mount<E, R>(
  basePath: string,
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest>,
) {
  if (basePath === "") return app
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (url.pathname === basePath) return HttpServerResponse.redirect(`${basePath}/${url.search}`, { status: 301 })
    if (!url.pathname.startsWith(`${basePath}/`)) return HttpServerResponse.empty({ status: 404 })
    // A doubled slash after the prefix would leave `//…`, which URL parsing reads as a different host.
    const pathname = url.pathname.slice(basePath.length).replace(/^\/+/, "/")
    return yield* app.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request.modify({ url: pathname + url.search })),
    )
  })
}

export * as BasePath from "./base-path"
