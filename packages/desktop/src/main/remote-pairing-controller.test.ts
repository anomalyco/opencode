import { describe, expect, test } from "bun:test"
import type { RemoteGatewayInfo } from "./remote-gateway"
import { createRemotePairingController } from "./remote-pairing-controller"

function fakeGateway(info: RemoteGatewayInfo) {
  let current: RemoteGatewayInfo | undefined
  let starts = 0
  let stops = 0
  return {
    gateway: {
      start: async () => {
        starts += 1
        current = info
        return info
      },
      stop: async () => {
        stops += 1
        current = undefined
      },
      status: () => current,
    },
    starts: () => starts,
    stops: () => stops,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("remote pairing controller", () => {
  test("creates a mobile URL while keeping Basic auth in the main-process request", async () => {
    const gateway = fakeGateway({
      port: 4123,
      urls: ["http://192.168.1.10:4123", "http://10.0.0.5:4123"],
    })
    let request: Request | undefined
    const controller = createRemotePairingController({
      getSidecar: async () => ({
        url: "http://127.0.0.1:4096",
        username: "opencode",
        password: "server-secret",
      }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ ticket: "one-time-ticket", expires_in: 300 })
      },
    })

    const result = await controller.create("session 1", "/tmp/project")

    expect(gateway.starts()).toBe(1)
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe(
      "http://127.0.0.1:4096/session/session%201/remote?directory=%2Ftmp%2Fproject",
    )
    expect(request?.headers.get("authorization")).toBe(`Basic ${btoa("opencode:server-secret")}`)
    expect(result).toEqual({
      url: "http://192.168.1.10:4123/remote/mobile#ticket=one-time-ticket",
      urls: [
        "http://192.168.1.10:4123/remote/mobile#ticket=one-time-ticket",
        "http://10.0.0.5:4123/remote/mobile#ticket=one-time-ticket",
      ],
      expiresIn: 300,
    })
  })

  test("stops a newly-created gateway when no LAN address is available", async () => {
    const gateway = fakeGateway({ port: 4123, urls: [] })
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
    })

    await expect(controller.create("session", "/tmp/project")).rejects.toThrow("No local network address")
    expect(gateway.starts()).toBe(1)
    expect(gateway.stops()).toBe(1)
  })

  test("revoke sends an authenticated DELETE without stopping an untracked shared gateway", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    await gateway.gateway.start()
    let request: Request | undefined
    const controller = createRemotePairingController({
      getSidecar: async () => ({
        url: "http://127.0.0.1:4096",
        username: null,
        password: "server-secret",
      }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(true)
      },
    })

    await controller.revoke("session", "/tmp/project")

    expect(request?.method).toBe("DELETE")
    expect(request?.headers.get("authorization")).toBe(`Basic ${btoa("opencode:server-secret")}`)
    expect(gateway.stops()).toBe(0)
  })

  test("does not stop a gateway it did not start after a paired session disconnects", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    await gateway.gateway.start()
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (_input, init) =>
        init?.method === "DELETE" ? Response.json(true) : Response.json({ ticket: "ticket", expires_in: 300 }),
    })

    await controller.create("session", "/tmp/project")
    await controller.revoke("session", "/tmp/project")

    expect(gateway.starts()).toBe(1)
    expect(gateway.stops()).toBe(0)
  })

  test("stops the gateway when the last tracked remote session disconnects", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (_input, init) =>
        init?.method === "DELETE" ? Response.json(true) : Response.json({ ticket: "ticket", expires_in: 300 }),
    })

    await controller.create("session", "/tmp/project")
    await controller.revoke("session", "/tmp/project")

    expect(gateway.stops()).toBe(1)
  })

  test("keeps the shared gateway until all tracked remote sessions disconnect", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (_input, init) =>
        init?.method === "DELETE" ? Response.json(true) : Response.json({ ticket: "ticket", expires_in: 300 }),
    })

    await controller.create("session-a", "/tmp/a")
    await controller.create("session-b", "/tmp/b")
    await controller.revoke("session-a", "/tmp/a")
    expect(gateway.stops()).toBe(0)

    await controller.revoke("session-b", "/tmp/b")
    expect(gateway.stops()).toBe(1)
  })

  test("prunes deleted tracked sessions before deciding whether the gateway is idle", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const deleted = new Set<string>()
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        if (request.method === "GET") {
          const sessionID = request.url.match(/\/session\/([^/?]+)/)?.[1]
          return new Response(null, { status: sessionID && deleted.has(decodeURIComponent(sessionID)) ? 404 : 200 })
        }
        if (request.method === "DELETE") return Response.json(true)
        return Response.json({ ticket: "ticket", expires_in: 300 })
      },
    })

    await controller.create("session-a", "/tmp/a")
    await controller.create("session-b", "/tmp/b")
    deleted.add("session-a")

    await controller.revoke("session-b", "/tmp/b")
    expect(gateway.stops()).toBe(1)
  })

  test("keeps a successful pairing alive when a concurrent pairing fails", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const successRequest = deferred<void>()
    const failedRequest = deferred<void>()
    const successResponse = deferred<Response>()
    const failedResponse = deferred<Response>()
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        if (request.method === "DELETE") return Response.json(true)
        if (request.method === "GET") return new Response(null, { status: 200 })
        if (request.url.includes("session-success")) {
          successRequest.resolve()
          return successResponse.promise
        }
        failedRequest.resolve()
        return failedResponse.promise
      },
    })

    const success = controller.create("session-success", "/tmp/success")
    const failed = controller.create("session-failed", "/tmp/failed")
    await Promise.all([successRequest.promise, failedRequest.promise])

    failedResponse.resolve(new Response(null, { status: 500 }))
    await expect(failed).rejects.toThrow("status 500")
    expect(gateway.stops()).toBe(0)

    successResponse.resolve(Response.json({ ticket: "ticket", expires_in: 300 }))
    await expect(success).resolves.toMatchObject({ expiresIn: 300 })
    expect(gateway.stops()).toBe(0)

    await controller.revoke("session-success", "/tmp/success")
    expect(gateway.stops()).toBe(1)
  })

  test("does not stop the gateway while another pairing is in flight", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    const pendingRequest = deferred<void>()
    const pendingResponse = deferred<Response>()
    const controller = createRemotePairingController({
      getSidecar: async () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
      gateway: gateway.gateway,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        if (request.method === "DELETE") return Response.json(true)
        if (request.method === "GET") return new Response(null, { status: 200 })
        if (request.url.includes("session-pending")) {
          pendingRequest.resolve()
          return pendingResponse.promise
        }
        return Response.json({ ticket: "ticket", expires_in: 300 })
      },
    })

    await controller.create("session-active", "/tmp/active")
    const pending = controller.create("session-pending", "/tmp/pending")
    await pendingRequest.promise

    await controller.revoke("session-active", "/tmp/active")
    expect(gateway.stops()).toBe(0)

    pendingResponse.resolve(new Response(null, { status: 500 }))
    await expect(pending).rejects.toThrow("status 500")
    expect(gateway.stops()).toBe(1)
  })
})
