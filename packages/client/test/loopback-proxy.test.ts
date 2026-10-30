import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isLoopbackUrl } from "../src/loopback"
import { OpenCode } from "../src/promise/index"
import { discover } from "../src/promise/service"

const proxyKeys = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const
const savedEnv = new Map<string, string | undefined>(proxyKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("identifies IPv4, IPv6, and localhost loopback URLs without matching lookalikes", () => {
  expect(isLoopbackUrl("http://localhost:4096/api/info")).toBe(true)
  expect(isLoopbackUrl("http://sub.localhost:4096/api/info")).toBe(true)
  expect(isLoopbackUrl("http://127.0.0.1:49374/api/info")).toBe(true)
  expect(isLoopbackUrl("http://127.0.0.2:4098/api/info")).toBe(true)
  expect(isLoopbackUrl("http://[::1]:49374/api/info")).toBe(true)
  expect(isLoopbackUrl("http://[0:0:0:0:0:0:0:1]:49374/api/info")).toBe(true)

  expect(isLoopbackUrl("http://evil-localhost:4096/api/info")).toBe(false)
  expect(isLoopbackUrl("http://127.1.2.3.example.com/api/info")).toBe(false)
  expect(isLoopbackUrl("https://api.example.com/v1")).toBe(false)
})

test("service discovery, API calls, and SSE streams bypass environment proxies on loopback", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-client-loopback-"))
  const proxied: Array<{ readonly url: string; readonly auth: string | null }> = []
  const connected = { id: "evt_connected", created: 0, type: "server.connected" as const, data: {} }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/info") return Response.json({ version: "2.0.0", pid: process.pid, urls: [] })
      if (pathname === "/api/event")
        return new Response(`data: ${JSON.stringify(connected)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      return new Response(null, { status: 404 })
    },
  })
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      proxied.push({ url: request.url, auth: request.headers.get("authorization") })
      return new Response("proxied", { status: 502 })
    },
  })

  try {
    for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] as const)
      process.env[key] = proxy.url.href
    delete process.env.NO_PROXY
    delete process.env.no_proxy

    const file = join(root, "service.json")
    await writeFile(
      file,
      JSON.stringify({
        id: "loopback-test",
        version: "2.0.0",
        url: server.url.href,
        pid: process.pid,
        password: "secret-service-password",
      }),
    )

    const endpoint = await discover({ file })
    expect(endpoint).toEqual({
      url: server.url.href,
      auth: { type: "basic", username: "opencode", password: "secret-service-password" },
    })

    const client = OpenCode.make({ baseUrl: server.url.href })
    expect(await client.server.info()).toEqual({ version: "2.0.0", pid: process.pid, urls: [] })
    const controller = new AbortController()
    const iterator = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: connected })
    controller.abort()

    expect(proxied).toEqual([])
  } finally {
    await server.stop(true)
    await proxy.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
