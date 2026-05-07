import fs from "node:fs/promises"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { ProxyUtil } from "../proxy-util"
import { UI_UPSTREAM, csp, cspForHtml, embeddedUI, upstreamURL } from "../shared/ui"

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = AppFileSystem.mimeType(match)
      const headers = new Headers({ "content-type": mime })
      const body = new Uint8Array(await fs.readFile(match))
      if (mime.startsWith("text/html")) {
        headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
      }
      return new Response(body, { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  const response = await proxy(upstreamURL(path), {
    raw: request,
    headers: ProxyUtil.headers(request, { host: UI_UPSTREAM.host }),
  })
  response.headers.set(
    "Content-Security-Policy",
    response.headers.get("content-type")?.includes("text/html") ? cspForHtml(await response.clone().text()) : csp(),
  )
  return response
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
