import { FSUtil } from "@opencode/util/fs-util"
import { Effect, FileSystem } from "effect"
import { HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHash } from "node:crypto"
import { load, type AssetMap, type BrotliMap } from "../app-assets"

export const handler = Effect.fn("cli.web-ui.handler")(function* (options?: {
  readonly assets?: AssetMap
  readonly brotli?: BrotliMap
  readonly basePath?: string
}) {
  const basePath = options?.basePath ?? ""
  const fileSystem = yield* FileSystem.FileSystem
  const assets = options?.assets
    ? Effect.succeed({ files: options.assets, brotli: options.brotli })
    : yield* Effect.cached(load().pipe(Effect.provideService(FileSystem.FileSystem, fileSystem)))
  return <E, R>(api: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://localhost")
      // Serve the web shell before API authentication so a signed-out browser gets the app's sign-in screen.
      if (
        url.pathname === "/api" ||
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/auth/") ||
        url.pathname === "/openapi.json"
      )
        return yield* api.pipe(
          Effect.catchIf(isRouteNotFound, () => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
        )
      return yield* assets.pipe(Effect.flatMap((loaded) => serveUI(request, url, loaded.files, loaded.brotli, basePath)))
    })
})

function serveUI(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  assets: AssetMap,
  brotli: BrotliMap | undefined,
  basePath: string,
) {
  const key = url.pathname.replace(/^\//, "")
  // Under a base path the manifest is rewritten, so its embedded brotli bytes would still carry root paths.
  const rewritten = basePath !== "" && key === "site.webmanifest"
  // A browser that takes brotli gets the embedded bytes as they are, so the server decompresses nothing. The HTML stays
  // decoded, because its CSP hashes the inline theme script.
  const encoded =
    key !== "index.html" && !rewritten && acceptsBrotli(request.headers["accept-encoding"]) ? brotli?.[key] : undefined
  const requested = encoded ?? assets[key]
  if ((key.startsWith("_assets/") || key.startsWith("icons/")) && requested === undefined)
    return Effect.succeed(HttpServerResponse.empty({ status: 404, headers: { "cache-control": "no-store" } }))
  const name = requested !== undefined ? key : "index.html"
  const original = requested ?? assets["index.html"]
  if (original === undefined) return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
  if (request.method !== "GET" && request.method !== "HEAD")
    return Effect.succeed(HttpServerResponse.empty({ status: 405 }))
  const html = name === "index.html"
  const file = prefixed(name, original, basePath)
  const revalidate = html || name === "sw.js" || name === "registerSW.js"
  const headers = {
    "content-type": FSUtil.mimeType(name),
    "cache-control": revalidate ? "no-cache" : "public, max-age=31536000, immutable",
    "content-security-policy": html ? cspForHtml(text(file)) : csp(),
    "x-content-type-options": "nosniff",
    ...(!html && brotli?.[name] !== undefined ? { vary: "accept-encoding" } : {}),
    ...(encoded ? { "content-encoding": "br" } : {}),
  }
  return Effect.succeed(
    request.method === "HEAD"
      ? HttpServerResponse.empty({ status: 200, headers })
      : HttpServerResponse.raw(file, { headers, contentType: headers["content-type"] }),
  )
}

// The build references its own files from the root. Under a base path, point the page and the manifest at the prefix,
// and tell the app where it is mounted. Scripts and stylesheets load their dependencies relative to themselves.
function prefixed(name: string, file: string | Uint8Array, basePath: string) {
  if (basePath === "") return file
  if (name === "index.html")
    return text(file)
      .replace(/((?:href|src|content)=["'])\/(?!\/)/g, `$1${basePath}/`)
      .replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n    <meta name="opencode-base-path" content="${basePath}" />`)
  if (name === "site.webmanifest")
    return JSON.stringify(
      JSON.parse(text(file), (_key, value) =>
        typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? basePath + value : value,
      ),
    )
  return file
}

function text(file: string | Uint8Array) {
  return typeof file === "string" ? file : Buffer.from(file).toString()
}

function acceptsBrotli(header: string | undefined) {
  return (header ?? "").split(",").some((entry) => {
    const parts = entry.split(";").map((part) => part.trim().toLowerCase())
    return parts[0] === "br" && !parts.slice(1).some((part) => /^q=0(?:\.0*)?$/.test(part))
  })
}

function isRouteNotFound(error: unknown) {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound"
}

// qr-scanner decodes in a worker it creates from a blob: URL whenever the browser has no BarcodeDetector (Safari, desktop
// Chrome on Windows and Linux). Without worker-src that worker falls under script-src 'self' and never starts.
// Artifact previews render HTML and PDF files from blob: URLs; without frame-src and object-src they fall back to
// default-src 'self' and are blocked.
function csp(hash = "") {
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'self' blob:`
}

function cspForHtml(body: string) {
  const match = body.match(
    /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
  )
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

export * as WebUi from "./web-ui"
