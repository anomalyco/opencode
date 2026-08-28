import { describe, expect, test } from "bun:test"
import { createServer } from "node:http"

describe("SSE disconnect cleanup", () => {
  test("Bun request aborted triggers response close and server remains responsive", async () => {
    const events: string[] = []
    const server = createServer((request: any, response: any) => {
      request.on("aborted", () => events.push("req-aborted"))
      request.on("close", () => events.push("req-close"))
      response.on("close", () => events.push("res-close"))
      // Apply the same fix as in process.ts for test
      if ((process as any).versions?.bun) {
        request.once("aborted", () => {
          if (!response.writableEnded && !response.destroyed) response.destroy()
        })
      }
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("data: ready\n\n")
      // Keep stream open
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address() as any
    const url = `http://127.0.0.1:${addr.port}/`
    const controller = new AbortController()
    const res = await fetch(url, { signal: controller.signal })
    const reader = res.body?.getReader()
    if (reader) {
      const { value } = await reader.read()
      expect(new TextDecoder().decode(value)).toContain("data: ready")
    }
    controller.abort()
    // Wait for close events
    await new Promise((r) => setTimeout(r, 100))
    // Server should have emitted res-close (via our fix on Bun, or natively on Node)
    // On Bun without fix, only req-aborted/req-close would appear; with fix, res-close appears
    // After disconnect, server should still handle health
    const healthRes = await fetch(url)
    expect(healthRes.status).toBe(200)
    // Verify events contain expected disconnect cleanup
    // On Node, expect res-close; on Bun with fix, also expect res-close
    expect(events).toContain("req-aborted")
    expect(events).toContain("res-close")
    server.close()
  })
})
