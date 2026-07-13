import { rename, writeFile } from "node:fs/promises"

const [registration, mode] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")

let requests = 0
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/api/health") return new Response(null, { status: 404 })
    requests += 1
    if (mode === "modern" && requests === 1) {
      await writeFile(registration + ".first-request", "")
      while (!(await Bun.file(registration + ".release").exists())) await Bun.sleep(5)
      return new Response(null, { status: 503 })
    }
    if (mode === "legacy") return Response.json({ healthy: true })
    return Response.json({ healthy: true, version: "test", pid: process.pid })
  },
})

await writeFile(
  registration + ".tmp",
  JSON.stringify({
    id: crypto.randomUUID(),
    version: mode === "legacy" ? undefined : "test",
    url: server.url.toString(),
    pid: process.pid,
  }),
  { mode: 0o600 },
)
await rename(registration + ".tmp", registration)

const shutdown = () => {
  server.stop(true)
  process.exit()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
