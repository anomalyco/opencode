import { rename, writeFile } from "node:fs/promises"

const [registration, mode, delay] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")
if (mode === "failed") process.exit(1)
if (mode === "signal") process.kill(process.pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL")

if (mode === "delayed" || mode === "delayed-failed") {
  const owner = await writeFile(registration + ".owner", String(process.pid), { flag: "wx" })
    .then(() => true)
    .catch(() => false)
  if (!owner) process.exit()
  await Bun.sleep(Number(delay))
  if (mode === "delayed-failed") process.exit(1)
}

let requests = 0
const version = mode === "old" ? "old" : "test"
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
    return Response.json({ healthy: true, version, pid: process.pid })
  },
})

await writeFile(
  registration + ".tmp",
  JSON.stringify({
    id: crypto.randomUUID(),
    version: mode === "legacy" ? undefined : version,
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
