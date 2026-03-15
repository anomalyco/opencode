import { createProxyServer } from "http-proxy"
import { createReadStream, existsSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"

const port = Number(process.env.PORT || "3000")
const apiBase = "http://127.0.0.1:4096"
const distDir = resolve(process.env.OPENCODE_APP_DIST_DIR || join(process.cwd(), "packages/app/dist"))
const indexFile = join(distDir, "index.html")
const backendPassword = process.env.OPENCODE_SERVER_PASSWORD || ""
const backendUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode"
const auth =
  backendPassword.length > 0 ? `Basic ${Buffer.from(`${backendUsername}:${backendPassword}`).toString("base64")}` : ""

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
} 

const proxy = createProxyServer({
  target: apiBase,
  changeOrigin: true,
  ws: true,
})

proxy.on("proxyReq", (proxyReq) => {
  if (auth) proxyReq.setHeader("Authorization", auth)
})

proxy.on("proxyReqWs", (proxyReq) => {
  if (auth) proxyReq.setHeader("Authorization", auth)
})

proxy.on("error", async (_err, req, res) => {
  if (!res || "headersSent" in res && res.headersSent) return
  res.writeHead(502, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify({ message: `Proxy failed for ${req.url ?? "unknown request"}` }))
})

function staticPath(urlPath) {
  const pathname = (urlPath || "/").split("?")[0]
  const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "")
  const target = join(distDir, safe.length === 0 ? "index.html" : safe)
  if (!target.startsWith(distDir)) return null
  if (existsSync(target) && statSync(target).isFile()) return target
  return null
}

const server = createServer(async (req, res) => {
  const url = req.url || "/"
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    res.end("ok")
    return
  }

  if (url.startsWith("/api/")) {
    req.url = url.slice(4) || "/"
    proxy.web(req, res)
    return
  }

  const file = staticPath(url)
  if (file) {
    const type = contentTypes[extname(file)] || "application/octet-stream"
    res.writeHead(200, { "content-type": type })
    createReadStream(file).pipe(res)
    return
  }

  const html = await readFile(indexFile)
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(html)
})

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/api/")) {
    socket.destroy()
    return
  }
  req.url = req.url.slice(4) || "/"
  proxy.ws(req, socket, head)
})

server.listen(port, "0.0.0.0", () => {
  console.log(`custom hosted app listening on http://0.0.0.0:${port}`)
})
