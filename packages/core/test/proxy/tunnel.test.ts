import { expect, test } from "bun:test"
import { makeAuthHeader, openTunnel } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

test("authenticates a CONNECT tunnel via Basic", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const authHeader = makeAuthHeader({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
  try {
    tunnel = await openTunnel(proxy.url, new URL("https://example.test/"), authHeader)
    expect(tunnel.socket).toBeDefined()
    expect(proxy.requests.length).toBe(1)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    tunnel?.socket.destroy()
    await proxy.close()
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
