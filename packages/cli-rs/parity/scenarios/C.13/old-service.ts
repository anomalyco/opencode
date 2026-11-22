// A background service of version 0.0.1 in its own process, registered for the channel `local` in the registration
// file named by argv[2]: ready on `/api/info`, with no terminals to hand over. The client that restarts it signals
// this process, never the runner. It ends itself after a minute in case no client did.
import { writeFile } from "node:fs/promises"

const file = process.argv[2]
if (!file) throw new Error("usage: bun old-service.ts <registration>")
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const { origin, pathname } = new URL(request.url)
    if (pathname === "/api/info")
      return Response.json({
        version: "0.0.1",
        pid: process.pid,
        urls: [`${origin}/`],
        paths: { tmp: "/tmp" },
        capabilities: { persistentPty: true },
      })
    if (pathname === "/api/experimental/persistent-pty/handoff") return Response.json({ handoff: null })
    return new Response("not found", { status: 404 })
  },
})
await writeFile(
  file,
  JSON.stringify({ id: "old", version: "0.0.1", url: server.url.toString(), pid: process.pid, password: "private" }),
  { mode: 0o600 },
)
setTimeout(() => process.exit(0), 60_000)
