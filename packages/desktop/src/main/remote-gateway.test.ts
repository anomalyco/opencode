import { afterEach, describe, expect, test } from "bun:test"
import * as http from "node:http"
import type { AddressInfo } from "node:net"
import type { NetworkInterfaceInfo } from "node:os"
import { createRemoteGateway } from "./remote-gateway"

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeIdleConnections()
          server.closeAllConnections()
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

  test("publishes only private IPv4 LAN addresses", async () => {
    const upstream = await listen((_request, response) => response.end("ok"))
    const gateway = createRemoteGateway({
      upstreamUrl: origin(upstream),
      networkInterfaces: () => ({
        wan: [networkAddress("203.0.113.8")],
        docker: [networkAddress("172.17.0.1")],
        corporate: [networkAddress("10.20.30.40")],
        wifi: [networkAddress("192.168.50.12")],
        loopback: [networkAddress("127.0.0.1", true)],
      }),
    })
    const info = await gateway.start()

    expect(info.urls).toEqual([
      `http://192.168.50.12:${info.port}`,
      `http://10.20.30.40:${info.port}`,
      `http://172.17.0.1:${info.port}`,
    ])

    await gateway.stop()
  })

  test("strips Connection-declared hop-by-hop request headers", async () => {
    let seen: http.IncomingHttpHeaders = {}
    const upstream = await listen((request, response) => {
      seen = request.headers
      response.end("ok")
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    await rawRequest(info.port, {
      connection: "keep-alive, x-remote-hop",
      "keep-alive": "timeout=5",
      "x-remote-hop": "secret",
      "x-end-to-end": "keep",
    })

    expect(seen["x-remote-hop"]).toBeUndefined()
    expect(seen["x-end-to-end"]).toBe("keep")

    await gateway.stop()
  })

  test("strips Connection-declared hop-by-hop response headers", async () => {
    const upstream = await listen((_request, response) => {
      response.setHeader("connection", "x-remote-hop")
      response.setHeader("x-remote-hop", "secret")
      response.setHeader("x-end-to-end", "keep")
      response.end("ok")
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    const response = await fetch(`http://127.0.0.1:${info.port}/remote/mobile`)
    expect(response.headers.get("x-remote-hop")).toBeNull()
    expect(response.headers.get("x-end-to-end")).toBe("keep")

    await gateway.stop()
  })

  test("stop closes active streaming connections", async () => {
    const upstream = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("data: connected\n\n")
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    const response = await fetch(`http://127.0.0.1:${info.port}/remote/session/test/events`)
    expect(response.status).toBe(200)
    expect(response.body).not.toBeNull()

    await gateway.stop()
    await response.body?.cancel().catch(() => undefined)
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

function networkAddress(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  }
}

function rawRequest(port: number, headers: http.OutgoingHttpHeaders) {
  return new Promise<void>((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/remote/mobile", headers }, (response) => {
      response.resume()
      response.on("end", resolve)
    })
    request.on("error", reject)
    request.end()
  })
}
