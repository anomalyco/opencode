import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { makeAuthHeader, openTunnel } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

async function startOrigin(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => socket.on("data", () => socket.write("ok")))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test("authenticates a CONNECT tunnel via Basic", async () => {
  const origin = await startOrigin()
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const authHeader = makeAuthHeader({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
  try {
    tunnel = await openTunnel(proxy.url, new URL(`https://127.0.0.1:${origin.port}/`), authHeader)
    expect(tunnel.socket).toBeDefined()
    expect(proxy.requests.length).toBe(1)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    tunnel?.socket.destroy()
    await proxy.close()
    await origin.close()
  }
})

test("CONNECT tunnel fails with an actionable error when rejected", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: () => false })
  const authHeader = makeAuthHeader({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  try {
    await expect(openTunnel(proxy.url, new URL("https://example.test/"), authHeader)).rejects.toThrow()
    expect(proxy.requests.length).toBeLessThanOrEqual(3)
  } finally {
    await proxy.close()
  }
})
