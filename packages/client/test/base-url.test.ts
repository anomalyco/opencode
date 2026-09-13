import { expect, test } from "bun:test"
import { OpenCode } from "../src/promise/index"

test.each(["", "/", "/proxy", "/proxy/", "/nested/proxy%20path", "/nested/proxy%20path/"])(
  "preserves server base path %j for requests and events",
  async (prefix) => {
    const requests: string[] = []
    const base = prefix.replace(/\/$/, "")
    const event = { id: "evt_connected", type: "server.connected", data: {} }
    using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)
        expect(request.headers.get("authorization")).toBe("Bearer test")
        if (url.pathname === `${base}/api/health`) return Response.json({ healthy: true, version: "test", pid: 123 })
        if (url.pathname === `${base}/api/session`) return Response.json({ data: [], cursor: null })
        if (url.pathname === `${base}/api/event`)
          return new Response(`data: ${JSON.stringify(event)}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          })
        return new Response("Not found", { status: 404 })
      },
    })
    const client = OpenCode.make({
      baseUrl: server.url.origin + prefix,
      headers: { authorization: "Bearer test" },
    })

    expect(await client.health.get()).toEqual({ healthy: true, version: "test", pid: 123 })
    await client.session.list({ directory: "/tmp/project" })
    const events = client.event.subscribe()[Symbol.asyncIterator]()
    try {
      expect((await events.next()).value).toEqual(event)
    } finally {
      await events.return?.()
    }
    expect(requests).toEqual([
      `${base}/api/health`,
      `${base}/api/session?directory=%2Ftmp%2Fproject`,
      `${base}/api/event`,
    ])
  },
)
