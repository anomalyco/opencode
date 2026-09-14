import path from "node:path"

const directory = process.env.PATCH_BUILD_DIR
if (!directory) throw new Error("PATCH_BUILD_DIR is required")
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PATCH_PORT ?? 4317),
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    const file = Bun.file(path.join(directory, pathname === "/" ? "index.html" : pathname))
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 })
  },
})
