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

  test("revoke sends an authenticated DELETE without stopping the shared gateway", async () => {
    const gateway = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
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
})
