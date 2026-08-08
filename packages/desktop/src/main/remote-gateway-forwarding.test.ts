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
          server.closeAllConnections()
        }),
    ),
  )
})

describe("remote gateway forwarding identity", () => {
  test("strips client-supplied forwarding identity before proxying", async () => {
    let seen: http.IncomingHttpHeaders = {}
    const upstream = await listen((request, response) => {
      seen = request.headers
      response.end("ok")
    })
    const gateway = createRemoteGateway({ upstreamUrl: origin(upstream) })
    const info = await gateway.start()

    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: info.port,
          path: "/remote/mobile",
          headers: {
            forwarded: "for=203.0.113.10;proto=https",
            "x-forwarded-for": "203.0.113.10",
            "x-forwarded-host": "attacker.invalid",
            "x-forwarded-port": "443",
            "x-forwarded-proto": "https",
            "x-real-ip": "203.0.113.10",
          },
        },
        (response) => {
          response.resume()
          response.on("end", resolve)
        },
      )
      request.on("error", reject)
      request.end()
    })

    expect(seen.forwarded).toBeUndefined()
    expect(seen["x-forwarded-for"]).toBeUndefined()
    expect(seen["x-forwarded-port"]).toBeUndefined()
    expect(seen["x-real-ip"]).toBeUndefined()
    expect(seen["x-forwarded-host"]).toBe(`127.0.0.1:${info.port}`)
    expect(seen["x-forwarded-proto"]).toBe("http")

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
