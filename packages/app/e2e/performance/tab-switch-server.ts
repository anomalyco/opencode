import path from "node:path"
import { parseArgs } from "node:util"
import { createMockServerHandler } from "../utils/mock-server"
import { fixture } from "./timeline/session-timeline-stress.fixture"
import { messages } from "./timeline/session-tab-switch.fixture"
import { createReviewDiffs } from "./timeline/timeline-test-helpers"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: { port: { type: "string", default: "4639" }, dist: { type: "string", default: "dist" } },
})
const directory = path.resolve(args.values.dist)
const api = createMockServerHandler({
  directory: fixture.directory,
  project: fixture.project,
  provider: fixture.provider,
  sessions: fixture.sessions,
  pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
  vcsDiff: createReviewDiffs(),
})
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(args.values.port),
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/event") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"id":"evt_fixture_connected","type":"server.connected","data":{}}\n\n'),
            )
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
      )
    }
    if (url.pathname.startsWith("/api/")) {
      const response = await api.handler(request)
      response.headers.set("cache-control", "no-store")
      return response
    }
    const file = Bun.file(path.join(directory, url.pathname))
    if (!url.pathname.endsWith("/") && (await file.exists())) {
      return new Response(file, {
        headers: {
          "cache-control": url.pathname.startsWith("/_assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        },
      })
    }
    return new Response(Bun.file(path.join(directory, "index.html")), { headers: { "cache-control": "no-cache" } })
  },
})
console.log(`Tab fixture: ${server.url} (${directory})`)
const close = async () => {
  await server.stop(true)
  await api.dispose()
}
process.once("SIGINT", close)
process.once("SIGTERM", close)
