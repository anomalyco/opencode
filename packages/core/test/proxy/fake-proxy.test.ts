import { expect, test } from "bun:test"
import { request } from "node:http"
import { startFakeProxy } from "./fake-proxy"

function throughProxy(
  proxy: URL,
  target: string,
  headers: Record<string, string>,
): Promise<{ status: number; auth: string[] }> {
  return new Promise((resolve, reject) => {
    const authorizationHeader = headers["proxy-authorization"]
    const auth: string[] = []
    if (typeof authorizationHeader === "string") auth.push(authorizationHeader)
    const req = request(
      {
        host: proxy.hostname,
        port: proxy.port,
        method: "GET",
        path: target,
        headers: { host: new URL(target).host, ...headers },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve({ status: res.statusCode ?? 0, auth }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

test("fake proxy challenges then accepts Basic", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: (scheme, header) => scheme === "basic" && header.startsWith("Basic ") })
  try {
    const unauth = await throughProxy(proxy.url, "http://example.test/", {})
    expect(unauth.status).toBe(407)

    const authed = await throughProxy(proxy.url, "http://example.test/", {
      "proxy-authorization": "Basic " + Buffer.from("u:p").toString("base64"),
    })
    expect(authed.status).toBe(200)

    // Both the rejected and accepted attempts are recorded for assertions.
    expect(proxy.requests.length).toBe(1)
    expect(proxy.requests[0]).toStartWith("Basic ")
  } finally {
    await proxy.close()
  }
})
