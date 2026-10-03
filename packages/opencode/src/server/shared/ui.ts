import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { ProxyUtil } from "../proxy-util"
import { compressible } from "../routes/instance/httpapi/middleware/compression"

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

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

interface EmbeddedFile {
  raw: Uint8Array
  mime: string
  csp?: string
  gzipped?: Uint8Array
}

// Embedded UI files are fixed for the process lifetime, so bodies — and their
// gzip variants — are read and compressed once instead of per request.
const embeddedFileCache = new Map<string, EmbeddedFile>()

function embeddedUIResponse(entry: EmbeddedFile, acceptsGzip: boolean) {
  const headers = new Headers({ "content-type": entry.mime })
  if (entry.mime.startsWith("text/html")) {
    entry.csp ??= cspForHtml(new TextDecoder().decode(entry.raw))
    headers.set("content-security-policy", entry.csp)
  }
  if (!compressible(entry.mime, entry.raw.byteLength)) return HttpServerResponse.raw(entry.raw, { headers })

  // Compressed responses must carry Vary so shared caches don't serve a gzip
  // body to clients that didn't send Accept-Encoding.
  headers.set("vary", "Accept-Encoding")
  if (!acceptsGzip) return HttpServerResponse.raw(entry.raw, { headers })
  entry.gzipped ??= gzipSync(entry.raw)
  headers.set("content-encoding", "gzip")
  return HttpServerResponse.raw(entry.gzipped, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
  headers: Record<string, string> = {},
) {
  // Only navigations (Accept: text/html) fall back to index.html; missing
  // assets must 404 so stale clients fail fast instead of parsing HTML as JS.
  const file =
    embeddedWebUI[requestPath.replace(/^\//, "")] ??
    (headers["accept"]?.includes("text/html") ? embeddedWebUI["index.html"] : null)
  if (!file) return Effect.succeed(notFound())

  const acceptsGzip = headers["accept-encoding"]?.includes("gzip") ?? false
  const cached = embeddedFileCache.get(file)
  if (cached) return Effect.succeed(embeddedUIResponse(cached, acceptsGzip))

  return fs.readFile(file).pipe(
    Effect.map((body) => {
      const entry: EmbeddedFile = { raw: body, mime: FSUtil.mimeType(file) }
      embeddedFileCache.set(file, entry)
      return embeddedUIResponse(entry, acceptsGzip)
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

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI, request.headers)

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
