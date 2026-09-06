import path from "node:path"

const root = process.env.HIGHLIGHT_BUNDLE
if (!root) throw new Error("Set HIGHLIGHT_BUNDLE")
Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.HIGHLIGHT_PORT ?? 4793),
  fetch(request) {
    const pathname = new URL(request.url).pathname
    return new Response(Bun.file(path.join(root, pathname === "/" ? "index.html" : pathname)))
  },
})
