import type { Endpoint } from "@opencode-ai/client/effect/service"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect } from "effect"
import { HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { load, type AssetMap } from "../app-assets"

export const handler = Effect.fn("cli.web-ui.handler")(function* (options?: {
  readonly assets?: AssetMap
}) {
  const assets = options?.assets ?? (yield* load())
  return <E, R>(api: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    api.pipe(
      Effect.catchIf(
        isRouteNotFound,
        () =>
          HttpServerRequest.HttpServerRequest.pipe(
            Effect.flatMap((request) => serveUI(request, new URL(request.url, "http://localhost"), assets)),
          ),
      ),
    )
})

export function url(endpoint: Endpoint) {
  const target = new URL(endpoint.url)
  if (endpoint.auth) {
    target.username = endpoint.auth.username
    target.password = endpoint.auth.password
  }
  return target.toString()
}

function serveUI(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  assets: AssetMap,
) {
  const key = url.pathname.replace(/^\//, "")
  const name = assets[key] !== undefined ? key : "index.html"
  const file = assets[name]
  if (!file) return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
  if (request.method !== "GET" && request.method !== "HEAD") return Effect.succeed(HttpServerResponse.empty({ status: 405 }))
  const html = name === "index.html"
  const headers = {
    "content-type": FSUtil.mimeType(name),
    "cache-control": html ? "no-cache" : "public, max-age=31536000, immutable",
    "content-security-policy": html ? cspForHtml(typeof file === "string" ? file : Buffer.from(file).toString()) : csp(),
    "x-content-type-options": "nosniff",
  }
  return Effect.succeed(
    request.method === "HEAD" ? HttpServerResponse.empty({ headers }) : HttpServerResponse.raw(file, { headers }),
  )
}

function isRouteNotFound(error: unknown) {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound"
}

function csp(hash = "") {
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:`
}

function cspForHtml(body: string) {
  const match = body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

export * as WebUi from "./web-ui"
