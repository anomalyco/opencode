import { Flag } from "@opencode-ai/core/flag/flag"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUIPromise
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = getMimeType(match) ?? "text/plain"
      const headers = new Headers({ "content-type": mime })
      if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
      return new Response(new Uint8Array(await fs.readFile(match)), { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  const response = await proxy(`https://app.opencode.ai${path}`, {
    raw: request,
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      host: "app.opencode.ai",
    },
  })
  const match = response.headers.get("content-type")?.includes("text/html")
    ? (await response.clone().text()).match(
        /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
      )
    : undefined
  const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
  response.headers.set("Content-Security-Policy", csp(hash))
  return response
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
