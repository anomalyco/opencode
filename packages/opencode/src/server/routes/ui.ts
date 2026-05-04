import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { ProxyUtil } from "../proxy-util"
import { DEFAULT_CSP, UI_UPSTREAM, csp, embeddedUI, injectBasePath, themePreloadHash, upstreamURL } from "../shared/ui"

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = AppFileSystem.mimeType(match)
      const headers = new Headers({ "content-type": mime })
        if (mime.startsWith("text/html")) {
          headers.set("content-security-policy", DEFAULT_CSP)
          const html = new TextDecoder().decode(await fs.readFile(match))
          const basePath = Flag.OPENCODE_SERVER_BASE_PATH
          return new Response(basePath ? injectBasePath(html, basePath) : html, { headers })
        }
    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  const response = await proxy(upstreamURL(path), {
    raw: request,
    headers: ProxyUtil.headers(request, { host: UI_UPSTREAM.host }),
  })
  const isHtml = response.headers.get("content-type")?.includes("text/html")
  if (!isHtml) {
    response.headers.set("Content-Security-Policy", csp())
    return response
  }
  const body = await response.text()
  const match = themePreloadHash(body)
  const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
  response.headers.set("Content-Security-Policy", csp(hash))
  const basePath = Flag.OPENCODE_SERVER_BASE_PATH
  return new Response(basePath ? injectBasePath(body, basePath) : body, { status: response.status, headers: response.headers })
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
