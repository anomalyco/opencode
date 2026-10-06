import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

// Stands in for a background server from before `/api/info` existed: it owns the registration
// and the port, but answers every request with 404.
const [registration, port] = process.argv.slice(2)
if (registration === undefined || port === undefined) throw new Error("Missing old protocol service arguments")
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(port),
  fetch: () => new Response("Not Found", { status: 404 }),
})
process.on("SIGTERM", () => {
  void server.stop(true)
  void rm(registration, { force: true }).then(() => process.exit(0))
})
await mkdir(path.dirname(registration), { recursive: true })
await Bun.write(
  registration + ".tmp",
  JSON.stringify({
    id: crypto.randomUUID(),
    version: "2.0.5",
    url: `http://127.0.0.1:${server.port}`,
    pid: process.pid,
    password: "old",
  }),
)
await rename(registration + ".tmp", registration)
