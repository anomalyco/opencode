import type { Endpoint } from "@opencode-ai/client/effect/service"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Stream } from "effect"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { load } from "../app-assets"

const UI_UPSTREAM = new URL("https://app.opencode.ai")
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

export const handler = Effect.fn("cli.web-ui.handler")(function* (options?: {
  readonly assets?: Readonly<Record<string, string>>
}) {
  const assets = options?.assets ?? (yield* Effect.promise(load))
  const client = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
  return <E, R>(api: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    api.pipe(
      Effect.catchIf(
        isRouteNotFound,
        () =>
          HttpServerRequest.HttpServerRequest.pipe(
            Effect.flatMap((request) => serveUI(client, request, new URL(request.url, "http://localhost"), assets)),
          ),
      ),
    )
})

export function url(endpoint: Endpoint) {
  const target = new URL(endpoint.url)
  if (endpoint.auth)
    target.searchParams.set("auth_token", btoa(`${endpoint.auth.username}:${endpoint.auth.password}`))
  return target.toString()
}

function serveUI(
  client: HttpClient.HttpClient,
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  assets: Readonly<Record<string, string>>,
) {
  const key = url.pathname.replace(/^\//, "")
  const file = assets[key] ?? assets["index.html"]
  if (!file) return proxyHttp(client, request, new URL(url.pathname + url.search, UI_UPSTREAM))
  if (request.method !== "GET" && request.method !== "HEAD") return Effect.succeed(HttpServerResponse.empty({ status: 405 }))
  return Effect.tryPromise(() => readFile(file)).pipe(
    Effect.map((body) => {
      const html = key === "" || file === assets["index.html"]
      const headers = {
        "content-type": FSUtil.mimeType(file),
        "cache-control": html ? "no-cache" : "public, max-age=31536000, immutable",
        "content-security-policy": html ? cspForHtml(body.toString()) : csp(),
        "x-content-type-options": "nosniff",
      }
      if (request.method === "HEAD") return HttpServerResponse.empty({ headers })
      return HttpServerResponse.raw(body, { headers })
    }),
    Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
  )
}

function proxyHttp(client: HttpClient.HttpClient, request: HttpServerRequest.HttpServerRequest, target: URL) {
  return client
    .execute(
      HttpClientRequest.make(request.method as never)(target, {
        headers: proxyHeaders(request.headers),
        body: requestBody(request),
      }),
    )
    .pipe(
      Effect.flatMap((response) => {
        const headers = new Headers(response.headers)
        headers.delete("content-encoding")
        headers.delete("content-length")
        headers.delete("set-cookie")
        if (response.headers["content-type"]?.includes("text/html")) {
          return response.text.pipe(
            Effect.map((body) => {
              headers.set("content-security-policy", cspForHtml(body))
              headers.set("cache-control", "no-store")
              return HttpServerResponse.text(body, { status: response.status, headers })
            }),
          )
        }
        headers.set("content-security-policy", csp())
        return Effect.succeed(
          HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
            status: response.status,
            headers,
          }),
        )
      }),
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 502 }))),
    )
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  if (request.source instanceof Request && request.source.body === null) return HttpBody.empty
  const length = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], length ? Number(length) : undefined)
}

function proxyHeaders(input: Record<string, string>) {
  const headers = new Headers(input)
  for (const key of input.connection?.split(",").map((item) => item.trim()) ?? []) headers.delete(key)
  for (const key of hop) headers.delete(key)
  headers.delete("accept-encoding")
  headers.delete("authorization")
  headers.delete("cookie")
  return headers
}

function isRouteNotFound(error: unknown) {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound"
}

function csp(hash = "") {
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: blob:`
}

function cspForHtml(body: string) {
  const match = body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

export * as WebUi from "./web-ui"
