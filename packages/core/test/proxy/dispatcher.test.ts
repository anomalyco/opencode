import { expect, test } from "bun:test"
import { MAX_AUTH_ROUNDS, makeDispatcher } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

test("authenticates an http request via Basic", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  try {
    const response = await dispatcher.fetch("http://example.test/")
    expect(response.status).toBe(200)
    expect(proxy.requests.length).toBe(1)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})

test("caps authentication rounds when the proxy keeps challenging", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: () => false })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "basic", username: "u", password: "p" })
  try {
    await expect(dispatcher.fetch("http://example.test/")).rejects.toThrow()
    expect(proxy.requests.length).toBeLessThanOrEqual(MAX_AUTH_ROUNDS)
    expect(proxy.requests.length).toBeGreaterThan(0)
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})

test("selects a provider from the advertised challenge", async () => {
  const proxy = await startFakeProxy({ schemes: ["NTLM", "Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "auto", username: "u", password: "p" })
  try {
    // Negotiate/NTLM have no native token source in this build, so auto falls through to Basic.
    const response = await dispatcher.fetch("http://example.test/")
    expect(response.status).toBe(200)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})
