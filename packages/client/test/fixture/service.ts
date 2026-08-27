import { appendFile, rename, writeFile } from "node:fs/promises"

const [registration, mode, delay] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")
if (mode === "failed") process.exit(1)
if (mode === "stderr-failed") {
  process.stderr.write("x".repeat(16_384) + "\nactionable startup failure\n")
  process.exit(1)
}
if (mode === "record-start") {
  await writeFile(registration + ".started", "")
  process.exit(1)
}
if (mode === "environment") await writeFile(registration + ".environment", process.env.OPENCODE_SERVICE_ENV_TEST ?? "")
if (mode === "environment" || mode === "handoff-loser" || mode === "handoff-winner")
  await appendFile(
    registration + ".handoffs",
    JSON.stringify({ handoff: process.env.OPENCODE_PTY_HANDOFF ?? null }) + "\n",
  )
if (mode === "handoff-loser") {
  await writeFile(registration + ".loser", "")
  while (!(await Bun.file(registration + ".winner").exists())) await Bun.sleep(5)
  process.exit(0)
}
if (mode === "signal") process.kill(process.pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL")

if (mode === "delayed" || mode === "delayed-failed" || mode === "coordinated" || mode === "coordinated-failed-loser") {
  await appendFile(registration + ".starts", process.pid + "\n")
  const owner = await writeFile(registration + ".owner", String(process.pid), { flag: "wx" })
    .then(() => true)
    .catch(() => false)
  if (!owner) process.exit(mode === "coordinated-failed-loser" ? 1 : 0)
  if (mode === "coordinated" || mode === "coordinated-failed-loser") {
    while ((await Bun.file(registration + ".starts").text()).trim().split("\n").length < 2) await Bun.sleep(10)
    if (mode === "coordinated-failed-loser") await Bun.sleep(Number(delay ?? 1_500))
  } else await Bun.sleep(Number(delay))
  if (mode === "delayed-failed") process.exit(1)
}

let requests = 0
let version = "test"
if (mode === "old" || mode === "handoff" || mode === "handoff-null" || mode === "handoff-failed") version = "old"
if (mode === "incompatible") version = "1.9.0"
if (mode === "compatible" || mode === "delayed-compatible") version = "2.1.0-next.1"
const id = crypto.randomUUID()
const handoff = {
  directory: registration + ".daemon",
  instanceID: crypto.randomUUID(),
  ticket: crypto.randomUUID(),
  expiresAt: Date.now() + 30_000,
}
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === "/api/experimental/persistent-pty/prepare-restart") {
      await appendFile(registration + ".pty-requests", "prepare\n")
      if (request.method !== "POST" || request.headers.get("authorization") !== "Basic " + btoa("opencode:private"))
        return new Response(null, { status: 401 })
      if (mode === "handoff-failed") return new Response(null, { status: 500 })
      if (mode === "handoff" || mode === "handoff-null") {
        await writeFile(registration + ".prepared", JSON.stringify(mode === "handoff-null" ? null : handoff))
        return Response.json({ handoff: mode === "handoff-null" ? null : handoff })
      }
      return new Response(null, { status: 404 })
    }
    if (pathname === "/api/experimental/persistent-pty/shutdown") {
      await appendFile(registration + ".pty-requests", "shutdown\n")
      return new Response(null, { status: 204 })
    }
    if (pathname !== "/api/health") return new Response(null, { status: 404 })
    requests += 1
    if (mode === "starting") await writeFile(registration + ".health-request", "")
    if (mode === "hanging") {
      await appendFile(registration + ".requests", process.pid + "\n")
      return new Promise<Response>(() => {})
    }
    if (mode === "modern" && requests === 1) {
      await writeFile(registration + ".first-request", "")
      while (!(await Bun.file(registration + ".release").exists())) await Bun.sleep(5)
      return new Response(null, { status: 503 })
    }
    if (mode === "legacy") return Response.json({ healthy: true })
    if (mode === "starting" && !(await Bun.file(registration + ".release").exists()))
      return Response.json({ healthy: true, version, pid: process.pid }, { status: 503 })
    if (mode === "failed-owner") return Response.json({ healthy: true, version, pid: process.pid }, { status: 500 })
    if (mode === "starting" || mode === "graceful") return Response.json({ healthy: true, version, pid: process.pid })
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
    password: "private",
  }),
  { mode: 0o600 },
)
await rename(registration + ".tmp", registration)
if (mode === "handoff-winner") await writeFile(registration + ".winner", "")

async function shutdown(signal?: NodeJS.Signals) {
  if (mode === "handoff" || mode === "handoff-null")
    await writeFile(registration + ".handoff-at-stop", await Bun.file(registration + ".pty-handoff").text())
  if (signal !== undefined) await writeFile(registration + ".signal", signal)
  server.stop(true)
  process.exit()
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
