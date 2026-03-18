import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function want(hostname: string, port: number) {
  const raw = hostname.trim()
  const host = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw
  if (!host.includes(":")) return `http://${host}:${port}`
  return `http://[${host}]:${port}`
}

describe("Server.listen URL", () => {
  test("accepts ipv4, ipv6, and domains", async () => {
    const cases = ["127.0.0.1", "0.0.0.0", "localhost", "::", "::1", "[::]", "[::1]"]

    for (const hostname of cases) {
      const server = Server.listen({ hostname, port: 0 })
      try {
        expect(server.port).toBeGreaterThan(0)
        expect(Server.url.origin).toBe(new URL(want(hostname, server.port!)).origin)
        expect(new URL(Server.url.toString()).origin).toBe(Server.url.origin)
      } finally {
        await server.stop(true)
      }
    }
  })
})
