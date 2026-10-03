import { expect, test } from "bun:test"
import { makeAuthHeader, openTunnel } from "../../src/proxy/dispatcher"
import type { ProxyAuthProvider } from "../../src/proxy/auth/provider"
import { startFakeProxy } from "./fake-proxy"

test("CONNECT includes the default HTTPS port when the URL omits it", async () => {
  let connectLine = ""
  const { createServer, connect } = await import("node:net")
  const proxy = createServer((socket) => {
    socket.once("data", (chunk) => {
      connectLine = chunk.toString().split("\r\n")[0]
      socket.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n")
      socket.destroy()
    })
  })
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
  const port = (proxy.address() as { port: number }).port
  const authHeader = makeAuthHeader({ url: new URL(`http://127.0.0.1:${port}`), auth: "basic" })
  try {
    await openTunnel(new URL(`http://127.0.0.1:${port}`), new URL("https://example.test/"), authHeader).catch(() => {})
    expect(connectLine).toBe("CONNECT example.test:443 HTTP/1.1")
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
  }
})

test("a stateful (NTLM-like) provider completes over multiple rounds", async () => {
  let calls = 0
  const stateful: ProxyAuthProvider = {
    scheme: "ntlm",
    async step() {
      calls++
      if (calls === 1) return "NTLM type1"
      if (calls === 2) return "NTLM type3"
      return undefined
    },
  }
  const proxy = await startFakeProxy({
    schemes: ["NTLM"],
    // Accept nothing: the point is that the loop keeps trying multi-round
    // providers rather than throwing "rejected" after the first attempt.
    accept: () => false,
  })
  const authHeader = makeAuthHeader({ url: proxy.url, auth: "ntlm" }, { providers: [stateful] })
  try {
    await openTunnel(proxy.url, new URL("https://example.test/"), authHeader).catch(() => {})
    expect(calls).toBeGreaterThanOrEqual(2)
  } finally {
    await proxy.close()
  }
})
