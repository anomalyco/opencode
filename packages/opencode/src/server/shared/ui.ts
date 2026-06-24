import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import * as nodePath from "node:path"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

const webUIModuleName = "opencode-web-ui.gen.ts"

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    Promise.race([
      import(webUIModuleName).then((module) => module.default as Record<string, string>),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]).catch(() => null))
}

export function resolveWebRoot(): string | undefined {
  const fromEnv = process.env.OPENCODE_WEB_ROOT
  if (fromEnv) return fromEnv

  try {
    const binaryDir = nodePath.dirname(process.execPath)
    const relativePath = nodePath.resolve(binaryDir, "..", "web-ui")
    return relativePath
  } catch {
    return undefined
  }
}

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:`
export const DEFAULT_CSP = csp()

function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function fileResponse(filePath: string, body: Uint8Array) {
  const mime = FSUtil.mimeType(filePath)
  const headers = new Headers({ "content-type": mime })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => fileResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

function serveFromDiskEffect(
  requestPath: string,
  webRoot: string,
  fs: FSUtil.Interface,
) {
  const cleanPath = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "")
  const filePath = nodePath.join(webRoot, cleanPath)

  return fs.readFile(filePath).pipe(
    Effect.map((body) => fileResponse(cleanPath, body)),
    Effect.catchReason("PlatformError", "NotFound", () => {
      if (requestPath.includes(".")) return Effect.succeed(notFound())
      const indexPath = nodePath.join(webRoot, "index.html")
      return fs.readFile(indexPath).pipe(
        Effect.map((body) => fileResponse("index.html", body)),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
      )
    }),
  )
}

function placeHolderPage(requestPath: string) {
  return HttpServerResponse.html(`<!doctype html>
<html lang="en">
<head><title>opencode-EF</title><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
<h1>opencode-EF</h1>
<p>Requested: <code>${requestPath}</code></p>
<p>Web UI assets not available. Run with embedded UI or set a web root.</p>
<hr>
<pre>opencode-EF evolution-brain</pre>
</body>
</html>`)
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: FSUtil.Interface; disableEmbeddedWebUi: boolean; webRoot?: string },
) {
  return Effect.gen(function* () {
    const path = new URL(request.url, "http://localhost").pathname

    if (services.webRoot) {
      return yield* serveFromDiskEffect(path, services.webRoot, services.fs)
    }

    const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))
    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI)

    return placeHolderPage(path)
  })
}
