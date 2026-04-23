import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { createRelay } from "../src"
import type { TunnelFrame } from "../src/protocol"

const SECRET = "test-secret"

describe("relay end-to-end", () => {
  let server: ReturnType<typeof Bun.serve>
  let relay: ReturnType<typeof createRelay>
  let url: string

  beforeAll(async () => {
    relay = createRelay({ secret: SECRET, publicUrl: "http://127.0.0.1:0" })
    server = Bun.serve({
      port: 0,
      fetch: relay.app.fetch,
      websocket: relay.websocket,
    })
    url = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    server.stop(true)
  })

  it("pairs, tunnels an HTTP request, and streams the response back", async () => {
    // 1. Pair
    const pairRes = await fetch(`${url}/pair`, { method: "POST" })
    const pair = (await pairRes.json()) as {
      code: string
      tunnelToken: string
      claimUrl: string
    }
    expect(pair.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    // 2. CLI opens outbound WebSocket with tunnelToken and answers HTTP frames
    const cli = new WebSocket(`${url.replace("http", "ws")}/tunnel?token=${pair.tunnelToken}`)
    const cliOpen = new Promise<void>((resolve) => {
      cli.onopen = () => resolve()
    })

    const app = new Hono().get("/hello", (c) => c.json({ hello: "world" }))

    cli.onmessage = async (event) => {
      const frame = JSON.parse(event.data as string) as TunnelFrame
      if (frame.type !== "http_request") return
      const origin = "http://local"
      const request = new Request(origin + frame.path, {
        method: frame.method,
        headers: frame.headers,
      })
      const response = await app.fetch(request)
      const headers: Record<string, string> = {}
      response.headers.forEach((v, k) => (headers[k] = v))
      cli.send(JSON.stringify({ id: frame.id, type: "http_response_head", status: response.status, headers }))
      if (response.body) {
        const reader = response.body.getReader()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue
          let bin = ""
          for (const byte of value) bin += String.fromCharCode(byte)
          cli.send(JSON.stringify({ id: frame.id, type: "http_chunk", data: btoa(bin), encoding: "base64" }))
        }
      }
      cli.send(JSON.stringify({ id: frame.id, type: "http_end" }))
    }

    await cliOpen
    // Give the relay a moment to register the tunnel before the claim races.
    await new Promise((r) => setTimeout(r, 50))

    // 3. Client claims the code
    const claimRes = await fetch(`${url}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pair.code }),
    })
    const claim = (await claimRes.json()) as { clientToken: string }
    expect(claim.clientToken).toBeString()

    // 4. Client sends a tunneled request through the relay
    const proxied = await fetch(`${url}/t/hello`, {
      headers: { authorization: `Bearer ${claim.clientToken}` },
    })
    expect(proxied.status).toBe(200)
    const body = (await proxied.json()) as { hello: string }
    expect(body.hello).toBe("world")

    cli.close()
  })

  it("rejects claimed codes on second use", async () => {
    const pairRes = await fetch(`${url}/pair`, { method: "POST" })
    const pair = (await pairRes.json()) as { code: string; tunnelToken: string }

    const first = await fetch(`${url}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pair.code }),
    })
    expect(first.status).toBe(200)

    const second = await fetch(`${url}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pair.code }),
    })
    expect(second.status).toBe(404)
  })

  it("rejects tunnel requests with no tunnel connected", async () => {
    const pairRes = await fetch(`${url}/pair`, { method: "POST" })
    const pair = (await pairRes.json()) as { code: string }
    const claim = await fetch(`${url}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pair.code }),
    })
    const { clientToken } = (await claim.json()) as { clientToken: string }
    const res = await fetch(`${url}/t/anything`, {
      headers: { authorization: `Bearer ${clientToken}` },
    })
    expect(res.status).toBe(502)
  })
})
