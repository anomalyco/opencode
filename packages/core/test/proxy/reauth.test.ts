import { expect, test } from "bun:test"
import { makeDispatcher } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

test("re-authenticates across requests when the proxy never keeps a session", async () => {
  // A proxy that challenges every request (for example after a ticket expires).
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  try {
    const first = await dispatcher.fetch("http://example.test/")
    const second = await dispatcher.fetch("http://example.test/")
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // Each request performed its own handshake; none reused a stale session.
    expect(proxy.requests.length).toBe(2)
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})
