import { Flag } from "@/flag/flag"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

// Try loading embedded UI from the compiled binary first,
// then fall back to the app dist directory (for dev serve),
// then fall back to app.opencode.ai proxy.
const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => {
      console.log("[ui] Embedded web UI loaded from compiled binary")
      return module.default as Record<string, string>
    }).catch(() => null)

// For dev serve: try loading directly from the app dist directory
const appDistDir = path.resolve(import.meta.dirname, "../../../../app/dist")
const localUIPromise = fs.exists(appDistDir).then((exists) => {
  if (!exists) return null
  console.log("[ui] Found local app dist directory:", appDistDir)
  return appDistDir
})

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

const devCsp = (hash = "") =>
  `default-src 'self' http://localhost:* http://127.0.0.1:*; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*`

const csp = (hash = "", isDev = false) =>
  isDev ? devCsp(hash) : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

export const UIRoutes = (): Hono =>
  new Hono().all("/*", async (c) => {
    const reqPath = c.req.path

    // 1. Try embedded UI (compiled binary)
    const embeddedWebUI = await embeddedUIPromise
    if (embeddedWebUI) {
      const match = embeddedWebUI[reqPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
      if (!match) return c.json({ error: "Not Found" }, 404)

      if (await fs.exists(match)) {
        const mime = getMimeType(match) ?? "text/plain"
        c.header("Content-Type", mime)
        if (mime.startsWith("text/html")) {
          c.header("Content-Security-Policy", csp("", false))
        }
        return c.body(new Uint8Array(await fs.readFile(match)))
      } else {
        return c.json({ error: "Not Found" }, 404)
      }
    }

    // 2. Try local app dist directory (dev serve)
    const distDir = await localUIPromise
    if (distDir) {
      const filePath = path.join(distDir, reqPath === "/" ? "index.html" : reqPath.replace(/^\//, ""))
      if (await fs.exists(filePath)) {
        const mime = getMimeType(filePath) ?? "text/plain"
        c.header("Content-Type", mime)
        if (mime.startsWith("text/html")) {
          const hash = "" // Could extract inline script hash for CSP if needed
          c.header("Content-Security-Policy", csp(hash, true))
        }
        return c.body(new Uint8Array(await fs.readFile(filePath)))
      }
      // SPA fallback: serve index.html for unknown routes
      const indexPath = path.join(distDir, "index.html")
      if (await fs.exists(indexPath)) {
        c.header("Content-Type", "text/html")
        c.header("Content-Security-Policy", csp("", true))
        return c.body(new Uint8Array(await fs.readFile(indexPath)))
      }
    }

    // 3. Fall back to app.opencode.ai proxy
    const response = await proxy(`https://app.opencode.ai${reqPath}`, {
      raw: c.req.raw,
      headers: {
        ...Object.fromEntries(c.req.raw.headers.entries()),
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
  })
