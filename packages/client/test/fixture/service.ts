import { appendFile, rename, writeFile } from "node:fs/promises"

const [registration, mode, delay] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")
if (mode === "failed") process.exit(1)
if (mode === "record-start") {
  await writeFile(registration + ".started", "")
  process.exit(1)
}
if (mode === "signal") process.kill(process.pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL")

if (mode === "delayed" || mode === "delayed-failed" || mode === "coordinated") {
  await appendFile(registration + ".starts", process.pid + "\n")
  const owner = await writeFile(registration + ".owner", String(process.pid), { flag: "wx" })
    .then(() => true)
    .catch(() => false)
  if (!owner) process.exit()
  if (mode === "coordinated") {
    while ((await Bun.file(registration + ".starts").text()).trim().split("\n").length < 2) await Bun.sleep(10)
  } else await Bun.sleep(Number(delay))
  if (mode === "delayed-failed") process.exit(1)
}

let requests = 0
const version = mode === "old" || mode === "reject-stop" ? "old" : "test"
const id = crypto.randomUUID()
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === "/api/service/stop" && mode === "reject-stop") {
      await writeFile(registration + ".stop-attempt", "")
      return Response.json({ accepted: false })
    }
    if (pathname === "/api/service/stop" && mode === "graceful") {
      const body = await request.json()
      if (typeof body !== "object" || body === null || body.instanceID !== id) return Response.json({ accepted: false })
      await writeFile(registration + ".stop", JSON.stringify(body))
      setTimeout(shutdown, 25)
      return Response.json({ accepted: true })
    }
    if (pathname !== "/api/health") return new Response(null, { status: 404 })
    requests += 1
    if (mode === "modern" && requests === 1) {
      await writeFile(registration + ".first-request", "")
      while (!(await Bun.file(registration + ".release").exists())) await Bun.sleep(5)
      return new Response(null, { status: 503 })
    }
    if (mode === "legacy") return Response.json({ healthy: true })
    if (mode === "starting" && !(await Bun.file(registration + ".release").exists()))
      return Response.json(
        { healthy: true, version, pid: process.pid, instanceID: id, status: { type: "starting" } },
        { status: 503 },
      )
    if (mode === "failed-owner")
      return Response.json(
        {
          healthy: true,
          version,
          pid: process.pid,
          instanceID: id,
          status: { type: "failed", message: "Could not open the database.", action: "Check the service logs." },
        },
        { status: 503 },
      )
    if (mode === "starting" || mode === "graceful" || mode === "reject-stop")
      return Response.json({ healthy: true, version, pid: process.pid, instanceID: id, status: { type: "ready" } })
    return Response.json({ healthy: true, version, pid: process.pid })
  },
})

await writeFile(
  registration + ".tmp",
  JSON.stringify({
    id,
    version: mode === "legacy" ? undefined : version,
    url: server.url.toString(),
    pid: process.pid,
  }),
  { mode: 0o600 },
)
await rename(registration + ".tmp", registration)

function shutdown() {
  server.stop(true)
  process.exit()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
