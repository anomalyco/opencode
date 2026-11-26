import { expect, test } from "bun:test"
import { EgressPolicy } from "../src/egress-policy.js"

test("falls back to the reachable verified address without a second DNS lookup", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("preview") })
  const lookups: string[] = []
  const policy = EgressPolicy.makePolicy({
    resolve: async (host) => {
      lookups.push(host)
      return [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ]
    },
  })
  try {
    const target = { host: "preview.example.invalid", port: Number(server.url.port) }
    policy.grant(target.host, target.port)
    const socket = await EgressPolicy.resolveAndConnect(target, policy)
    try {
      expect(socket.remoteAddress).toBe("127.0.0.1")
      expect(lookups).toEqual([target.host])
    } finally {
      socket.destroy()
    }
  } finally {
    await server.stop(true)
  }
})
