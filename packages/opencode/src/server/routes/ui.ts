import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { ProxyUtil } from "../proxy-util"
import { UI_UPSTREAM, csp, embeddedUI, embeddedUIFile, embeddedUIHeaders, themePreloadHash, upstreamURL } from "../shared/ui"

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedUIFile(path, embeddedWebUI)
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const body = new Uint8Array(await fs.readFile(match))
      return new Response(body, { headers: embeddedUIHeaders(match, body) })
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
