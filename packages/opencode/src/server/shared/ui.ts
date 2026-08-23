import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { ProxyUtil } from "../proxy-util"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export const UI_UPSTREAM = new URL("https://app.opencode.ai")

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string) {
  return new URL(path, UI_UPSTREAM).toString()
}

// PERF: embedded assets are immutable for the process lifetime, so cache the
// file bytes to skip disk reads on repeat fetches (the web UI re-requests
// sprites/fonts per view). A fresh Response is built per request: Response
// bodies are one-shot streams per the fetch spec, so instances must not be
// shared across requests. Map insertion order doubles as LRU eviction order.
const embeddedUICache = new Map<string, { body: Uint8Array; contentType: string; csp: string | undefined }>()

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(cached: { body: Uint8Array; contentType: string; csp: string | undefined }) {
  const headers = new Headers({ "content-type": cached.contentType })
  if (cached.csp !== undefined) headers.set("content-security-policy", cached.csp)
  return HttpServerResponse.raw(cached.body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const path = requestPath.split("?")[0].replace(/^\//, "")
  const file = embeddedWebUI[path] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  const cached = embeddedUICache.get(path)
  if (cached) {
    embeddedUICache.delete(path)
    embeddedUICache.set(path, cached)
    return Effect.succeed(embeddedUIResponse(cached))
  }

  return fs.readFile(file).pipe(
    Effect.map((body) => {
      const contentType = FSUtil.mimeType(file)
      const entry = {
        body,
        contentType,
        csp: contentType.startsWith("text/html") ? cspForHtml(new TextDecoder().decode(body)) : undefined,
      }
      if (embeddedUICache.size >= 512) {
        const oldest = embeddedUICache.keys().next()
        if (!oldest.done) embeddedUICache.delete(oldest.value)
      }
      embeddedUICache.set(path, entry)
      return embeddedUIResponse(entry)
    }),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: FSUtil.Interface; client: HttpClient.HttpClient; disableEmbeddedWebUi: boolean },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))
    const path = new URL(request.url, "http://localhost").pathname

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI)

    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(path), {
        headers: ProxyUtil.headers(request.headers, { host: UI_UPSTREAM.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
