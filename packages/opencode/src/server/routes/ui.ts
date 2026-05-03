import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { ProxyUtil } from "../proxy-util"
import { DEFAULT_CSP, UI_UPSTREAM, csp, embeddedUI, themePreloadHash, upstreamURL } from "../shared/ui"

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = AppFileSystem.mimeType(match)
      const headers = new Headers({ "content-type": mime })
      if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
      return new Response(new Uint8Array(await fs.readFile(match)), { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  const response = await proxy(upstreamURL(path), {
    raw: request,
    headers: ProxyUtil.headers(request, { host: UI_UPSTREAM.host }),
  })
  const match = response.headers.get("content-type")?.includes("text/html")
    ? themePreloadHash(await response.clone().text())
    : undefined
  const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
  response.headers.set("Content-Security-Policy", csp(hash))
  return response
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
