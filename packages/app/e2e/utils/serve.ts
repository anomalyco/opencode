import { stat } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

// Serves the e2e build with vite preview's routing rules. vite preview checks the case of every requested
// path with a synchronous directory read on case-insensitive file systems (Windows, macOS), and the
// 3000-file _assets directory makes that the bottleneck for every page load across all workers.
const options = parseArgs({ options: { host: { type: "string" }, port: { type: "string" } } }).values

const dist = path.resolve(import.meta.dirname, "../../dist")

// Sent as text like vite's index.html middleware, so a media Range request that falls back gets a plain 200.
const index = await Bun.file(path.join(dist, "index.html")).text()

Bun.serve({
  hostname: options.host,
  port: Number(options.port),
  async fetch(request) {
    const pathname = decode(new URL(request.url).pathname)

    if (pathname === undefined) return new Response(null, { status: 404 })

    const target = path.resolve(dist, `.${pathname}`)

    // Like vite's existsSync, a name the file system rejects (too long, NUL) is treated as missing.
    const stats = target.startsWith(dist + path.sep) ? await stat(target).catch(() => undefined) : undefined

    if (stats?.isFile()) {
      const file = Bun.file(target)

      return new Response(file, {
        // Bun names .aac audio/x-aac, and only keeps the type on HEAD responses when it is set explicitly.
        headers: { "content-type": path.extname(target) === ".aac" ? "audio/aac" : file.type },
      })
    }

    if (fallback(request, pathname))
      return new Response(index, { headers: { "content-type": "text/html;charset=utf-8" } })

    return new Response(null, { status: 404 })
  },
})

function decode(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

// Mirrors vite's htmlFallbackMiddleware: only page loads get index.html, so a missing script or a fetch
// asking for JSON still sees a 404.
function fallback(request: Request, pathname: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return false

  if (pathname === "/favicon.ico") return false

  // vite's index.html middleware never answers a script load with the page, so a missing chunk stays a 404.
  if (request.headers.get("sec-fetch-dest") === "script") return false

  const accept = request.headers.get("accept")

  return !accept || accept.includes("text/html") || accept.includes("*/*")
}
