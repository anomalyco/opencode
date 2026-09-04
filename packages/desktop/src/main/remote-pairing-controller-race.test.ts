import { describe, expect, test } from "bun:test"
import type { RemoteGatewayInfo } from "./remote-gateway"
import { createRemotePairingController } from "./remote-pairing-controller"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fakeGateway(info: RemoteGatewayInfo) {
  let current: RemoteGatewayInfo | undefined
  let stops = 0
  return {
    gateway: {
      start: async () => {
        current = info
        return info
      },
      stop: async () => {
        stops += 1
        current = undefined
      },
      status: () => current,
    },
    stops: () => stops,
  }
}

describe("remote pairing prune races", () => {
  test("a revoke cannot stop the gateway while create is pruning stale sessions", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const pruneStarted = deferred<void>()
    const pruneResponse = deferred<Response>()
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        if (request.method === "GET") {
          pruneStarted.resolve()
          return pruneResponse.promise
        }
        if (request.method === "DELETE") return Response.json(true)
        return Response.json({ ticket: "ticket", expires_in: 300 })
      },
    })

    await controller.create("session-a", "/tmp/a")
    const creating = controller.create("session-b", "/tmp/b")
    await pruneStarted.promise

    await controller.revoke("session-a", "/tmp/a")
    expect(gateway.stops()).toBe(0)

    pruneResponse.resolve(new Response(null, { status: 404 }))
    await expect(creating).resolves.toMatchObject({ expiresIn: 300 })
    expect(gateway.stops()).toBe(0)

    await controller.revoke("session-b", "/tmp/b")
    expect(gateway.stops()).toBe(1)
  })
})
