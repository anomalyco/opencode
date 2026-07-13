import { writeFile } from "node:fs/promises"

const [registration, version, mode, firstRequest, release] = process.argv.slice(2)
if (registration === undefined || version === undefined || mode === undefined)
  throw new Error("Missing service fixture arguments")

let requests = 0
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/api/health") return new Response(null, { status: 404 })
    requests += 1
    if (mode === "block-first" && requests === 1) {
      if (firstRequest === undefined || release === undefined) throw new Error("Missing probe barrier paths")
      await writeFile(firstRequest, "")
      while (!(await Bun.file(release).exists())) await Bun.sleep(5)
      return new Response(null, { status: 503 })
    }
    return Response.json({ healthy: true, version, pid: process.pid })
  },
})

const id = crypto.randomUUID()
await writeFile(registration, JSON.stringify({ id, version, url: server.url.toString(), pid: process.pid }), {
  mode: 0o600,
})

const shutdown = () => {
  server.stop(true)
  process.exit()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
