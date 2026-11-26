#!/usr/bin/env bun
// Serves web/ for the demo under the Content-Security-Policy a host page needs (see README.md), so what works here
// works under that policy. Usage: bun scripts/serve.ts [port]

import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const port = Number(process.argv[2] ?? 4173)
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
].join("; ")
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json",
}

const server = Bun.serve({
  port,
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname)
    if (p === "/") return Response.redirect("/demo/", 302)
    if (p.endsWith("/")) p += "index.html"
    const file = path.join(root, path.normalize(p))
    if (!file.startsWith(root + path.sep)) return new Response("forbidden", { status: 403 })
    const f = Bun.file(file)
    if (!(await f.exists())) return new Response("not found", { status: 404 })
    return new Response(f, {
      headers: {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "content-security-policy": CSP,
        "cache-control": "no-cache",
      },
    })
  },
})
console.log(`http://localhost:${server.port}/demo/`)
