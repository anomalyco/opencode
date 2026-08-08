import { afterEach, describe, expect, test } from "bun:test"
import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { createRemoteGateway } from "./remote-gateway"

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeIdleConnections()
        }),
    ),
  )
})

describe("remote gateway", () => {
  test("proxies only /remote routes", async () => {
    const upstream = await listen((request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ url: request.url, authorization: request.headers.authorization ?? null }))
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    const remote = await fetch(`http://127.0.0.1:${info.port}/remote/session/test`, {
      headers: { authorization: "Bearer remote-token" },
    })
    expect(remote.status).toBe(200)
    expect(await remote.json()).toEqual({
      url: "/remote/session/test",
      authorization: "Bearer remote-token",
    })

    const blocked = await fetch(`http://127.0.0.1:${info.port}/session/test`)
    expect(blocked.status).toBe(404)

    await gateway.stop()
  })

  test("forwards request bodies and response headers", async () => {
    const upstream = await listen((request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      response.setHeader("x-remote-test", "ok")
      response.end(Buffer.concat(chunks))
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    const response = await fetch(`http://127.0.0.1:${info.port}/remote/pair/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: "one-time" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("x-remote-test")).toBe("ok")
    expect(await response.json()).toEqual({ ticket: "one-time" })

    await gateway.stop()
  })

  test("start and stop are idempotent", async () => {
    const upstream = await listen((_request, response) => response.end("ok"))
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })

    const first = await gateway.start()
    const second = await gateway.start()
    expect(second).toEqual(first)

    await gateway.stop()
    await gateway.stop()
  })
})

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server
}

function origin(server: http.Server) {
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}
