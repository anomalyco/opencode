import index from "./src/index.html"

const publicDirectory = new URL("./public/", import.meta.url)
const port = Number(process.env.PORT ?? "4187")

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
])

const server = Bun.serve({
  port,
  development: process.env.NODE_ENV === "production" ? false : { hmr: true, console: true },
  routes: {
    "/": index,
  },
  async fetch(request) {
    const url = new URL(request.url)
    const path = normalizePath(url.pathname)
    if (!path) return new Response("Not found", { status: 404 })

    const file = Bun.file(new URL(path, publicDirectory))
    if (!(await file.exists())) return new Response("Not found", { status: 404 })

    return new Response(file, {
      headers: {
        "cache-control": "no-store",
        "content-type": contentType(path),
      },
    })
  },
})

console.log(`OpenCode terminal catalog: http://localhost:${server.port}`)

function normalizePath(pathname: string) {
  const decoded = decodeURIComponent(pathname)
  const path = decoded.replace(/^\/+/, "")
  if (path === "" || path.includes("..") || path.includes("\\")) return undefined
  return path
}

function contentType(path: string) {
  const dot = path.lastIndexOf(".")
  const extension = dot === -1 ? "" : path.slice(dot)
  return contentTypes.get(extension) ?? "application/octet-stream"
}
