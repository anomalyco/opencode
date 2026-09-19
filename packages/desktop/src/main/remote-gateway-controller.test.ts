import { describe, expect, test } from "bun:test"
import type { RemoteGatewayInfo } from "./remote-gateway"
import { createRemoteGatewayController } from "./remote-gateway-controller"

function fakeGateway(info: RemoteGatewayInfo, beforeStop?: Promise<void>) {
  let running: RemoteGatewayInfo | undefined
  let starts = 0
  let stops = 0
  return {
    gateway: {
      start: async () => {
        starts += 1
        running = info
        return info
      },
      stop: async () => {
        stops += 1
        await beforeStop
        running = undefined
      },
      status: () => running,
    },
    starts: () => starts,
    stops: () => stops,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("remote gateway controller", () => {
  test("starts lazily and reuses the active gateway", async () => {
    const fake = fakeGateway({ port: 4123, urls: ["http://192.168.1.10:4123"] })
    let upstreamCalls = 0
    let factoryCalls = 0
    const controller = createRemoteGatewayController({
      getUpstreamUrl: async () => {
        upstreamCalls += 1
        return "http://127.0.0.1:4096"
      },
      createGateway: (url) => {
        factoryCalls += 1
        expect(url).toBe("http://127.0.0.1:4096")
        return fake.gateway
      },
    })

    const [first, second] = await Promise.all([controller.start(), controller.start()])
    expect(first).toEqual(second)
    expect(controller.status()).toEqual(first)
    expect(upstreamCalls).toBe(1)
    expect(factoryCalls).toBe(1)
    expect(fake.starts()).toBe(1)
  })

  test("stop is idempotent and the controller can restart", async () => {
    const created: ReturnType<typeof fakeGateway>[] = []
    const controller = createRemoteGatewayController({
      getUpstreamUrl: async () => "http://127.0.0.1:4096",
      createGateway: () => {
        const fake = fakeGateway({ port: 5000 + created.length, urls: [] })
        created.push(fake)
        return fake.gateway
      },
    })

    await controller.start()
    await Promise.all([controller.stop(), controller.stop()])
    expect(controller.status()).toBeUndefined()
    expect(created[0]?.stops()).toBe(1)

    await controller.start()
    expect(created).toHaveLength(2)
    expect(created[1]?.starts()).toBe(1)
  })

  test("start waits for an in-flight stop before replacing the gateway", async () => {
    const gate = deferred()
    const created: ReturnType<typeof fakeGateway>[] = []
    const controller = createRemoteGatewayController({
      getUpstreamUrl: async () => "http://127.0.0.1:4096",
      createGateway: () => {
        const fake = fakeGateway(
          { port: 7000 + created.length, urls: [] },
          created.length === 0 ? gate.promise : undefined,
        )
        created.push(fake)
        return fake.gateway
      },
    })

    await controller.start()
    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.resolve()

    expect(created).toHaveLength(1)
    gate.resolve()
    await stopping

    expect(await restarting).toEqual({ port: 7001, urls: [] })
    expect(created).toHaveLength(2)
    expect(created[0]?.stops()).toBe(1)
    expect(created[1]?.starts()).toBe(1)
  })

  test("failed start can be retried", async () => {
    let attempts = 0
    const fake = fakeGateway({ port: 6000, urls: [] })
    const controller = createRemoteGatewayController({
      getUpstreamUrl: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("sidecar unavailable")
        return "http://127.0.0.1:4096"
      },
      createGateway: () => fake.gateway,
    })

    await expect(controller.start()).rejects.toThrow("sidecar unavailable")
    expect(controller.status()).toBeUndefined()
    expect(await controller.start()).toEqual({ port: 6000, urls: [] })
    expect(attempts).toBe(2)
  })
})
