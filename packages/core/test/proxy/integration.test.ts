import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { httpClientLayer } from "../../src/proxy"
import { startFakeProxy } from "./fake-proxy"

test("shared http client proxies and authenticates", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => header.startsWith("Basic ") })
  const previousHttp = process.env.HTTP_PROXY
  const previousHttps = process.env.HTTPS_PROXY
  // Credentials travel as URL userinfo, which `resolve` reads.
  process.env.HTTP_PROXY = `http://u:p@127.0.0.1:${proxy.url.port}`
  process.env.HTTPS_PROXY = process.env.HTTP_PROXY
  try {
    const client = await Effect.runPromise(HttpClient.HttpClient.pipe(Effect.provide(httpClientLayer)))
    const response = await Effect.runPromise(client.execute(HttpClientRequest.get("http://example.test/")))
    expect(response.status).toBe(200)
    expect(proxy.requests.length).toBe(1)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    if (previousHttp === undefined) delete process.env.HTTP_PROXY
    else process.env.HTTP_PROXY = previousHttp
    if (previousHttps === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = previousHttps
    await proxy.close()
  }
})
