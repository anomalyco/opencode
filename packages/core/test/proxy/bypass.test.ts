import { expect, test } from "bun:test"
import http from "node:http"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { httpClientLayer } from "../../src/proxy"
import { startFakeProxy } from "./fake-proxy"

test("loopback targets bypass the proxy end to end", async () => {
  const local = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("direct")
  })
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve))
  const port = (local.address() as { port: number }).port

  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: () => true })
  const previous = process.env.HTTP_PROXY
  const previousNoProxy = process.env.NO_PROXY
  process.env.HTTP_PROXY = proxy.url.toString()
  delete process.env.NO_PROXY
  try {
    const client = await Effect.runPromise(HttpClient.HttpClient.pipe(Effect.provide(httpClientLayer)))
    const response = await Effect.runPromise(client.execute(HttpClientRequest.get(`http://127.0.0.1:${port}/`)))
    expect(response.status).toBe(200)
    expect(await Effect.runPromise(response.text)).toBe("direct")
    expect(proxy.requests.length).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.HTTP_PROXY
    else process.env.HTTP_PROXY = previous
    if (previousNoProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = previousNoProxy
    await proxy.close()
    await new Promise<void>((resolve) => local.close(() => resolve()))
  }
})
