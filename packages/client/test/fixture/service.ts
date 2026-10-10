import { appendFile, rename, rm, writeFile } from "node:fs/promises"
import { writeSync } from "node:fs"

const [registration, mode, delay] = process.argv.slice(2)
if (registration === undefined || mode === undefined) throw new Error("Missing service fixture arguments")
if (mode === "failed") process.exit(1)
if (mode === "stderr-failed") {
  process.stderr.write(
    "x".repeat(16_384) + '\nactionable startup failure\n{"type":"port-conflict","hostname":"127.0.0.1","port":49374}\n',
  )
  process.exit(1)
}
if (mode === "record-start") {
  await writeFile(registration + ".started", "")
  process.exit(1)
}
if (mode === "environment") {
  await writeFile(registration + ".environment", process.env.OPENCODE_SERVICE_ENV_TEST ?? "")
  await writeFile(registration + ".handoff", process.env.OPENCODE_PTY_HANDOFF ?? "null")
}
if (mode === "signal") process.kill(process.pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL")

let controlled = ""
if (mode === "controlled") {
  await appendFile(registration + ".starts", process.pid + "\n")
  const release = registration + `.release-${process.pid}`
  while (!(await Bun.file(release).exists())) await Bun.sleep(5)
  controlled = await Bun.file(release).text()
  if (controlled === "conflict") {
    writeSync(3, JSON.stringify({ type: "port-conflict", hostname: "127.0.0.1", port: 49374 }))
    process.exit(23)
  }
  if (controlled === "fail") {
    process.stderr.write("actionable startup failure: storage initialization denied\n")
    process.exit(23)
  }
}

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
if (mode === "old" || mode === "handoff") version = "old"
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
  async fetch(request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (mode === "protocol" && pathname === "/api/experimental/persistent-pty/handoff") {
      await writeFile(registration + ".handoff-request", "")
      return Response.json({ handoff: null })
    }
    if (pathname === "/api/experimental/persistent-pty/handoff" && mode === "handoff") {
      if (request.method !== "POST" || request.headers.get("authorization") !== "Basic " + btoa("opencode:private"))
        return new Response(null, { status: 401 })
      await writeFile(registration + ".prepared", JSON.stringify(handoff))
      return Response.json({ handoff })
    }
    if (pathname === "/api/experimental/persistent-pty/handoff" && mode === "handoff-broken")
      return new Response(null, { status: 500 })
    if (pathname !== "/api/info") return new Response(null, { status: 404 })
    if (mode === "protocol" && (await Bun.file(registration + ".missing-health").exists()))
      return new Response(null, { status: 404 })
    requests += 1
    if (mode === "starting") await writeFile(registration + ".status-request", "")
    if (mode === "hanging" || controlled === "hang") {
      await appendFile(registration + ".requests", process.pid + "\n")
      return new Promise<Response>(() => {})
    }
    if (mode === "modern" && requests === 1) {
      await writeFile(registration + ".first-request", "")
      while (!(await Bun.file(registration + ".release").exists())) await Bun.sleep(5)
      return new Response(null, { status: 503 })
    }
    if (mode === "starting" && !(await Bun.file(registration + ".release").exists()))
      return Response.json(
        { version, pid: process.pid, urls: [server.url.toString()], paths: { tmp: "/tmp/opencode" } },
        { status: 503 },
      )
    if (mode === "failed-owner")
      return Response.json(
        { version, pid: process.pid, urls: [server.url.toString()], paths: { tmp: "/tmp/opencode" } },
        { status: 500 },
      )
    return Response.json({
      version,
      pid: process.pid,
      urls: [server.url.toString()],
      paths: { tmp: "/tmp/opencode" },
    })
  },
})

// Install handlers before publishing: a test may signal as soon as the registration appears.
if (controlled !== "hang") {
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))
}

await writeFile(
  registration + ".tmp",
  JSON.stringify({
    id,
    version,
    url: server.url.toString(),
    pid: process.pid,
    password: "private",
  }),
  { mode: 0o600 },
)
await rename(registration + ".tmp", registration)

async function shutdown(signal?: NodeJS.Signals) {
  if (signal !== undefined) await writeFile(registration + ".signal", signal)
  // A lingering server unregisters on SIGTERM but keeps running, and holds its port, until killed.
  if (mode === "lingering") {
    await rm(registration, { force: true })
    await writeFile(registration + ".unregistered", "")
    await Bun.sleep(Number(delay))
  }
  server.stop(true)
  process.exit()
}
