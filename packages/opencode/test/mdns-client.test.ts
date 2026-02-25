import { beforeEach, describe, expect, mock, test } from "bun:test"

const events: Array<{
  delay: number
  service: {
    name: string
    host: string
    port: number
    txt?: Record<string, string>
  }
}> = []

let stop = 0
let destroy = 0

mock.module("bonjour-service", () => ({
  Bonjour: class MockBonjour {
    find(
      _query: unknown,
      onService: (service: { name: string; host: string; port: number; txt?: Record<string, string> }) => void,
    ) {
      for (const item of events) {
        setTimeout(() => onService(item.service), item.delay)
      }

      return {
        stop: () => {
          stop++
        },
      }
    }

    destroy() {
      destroy++
    }
  },
}))

const { find } = await import("../src/mdns/client")

beforeEach(() => {
  events.length = 0
  stop = 0
  destroy = 0
})

describe("mdns.client.find", () => {
  test("waits for first result before idle timeout", async () => {
    events.push({
      delay: 70,
      service: {
        name: "opencode-4096",
        host: "test.local",
        port: 4096,
        txt: { path: "/" },
      },
    })

    const list = await find(AbortSignal.timeout(300), 10)

    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({
      name: "opencode-4096",
      host: "test.local",
      port: 4096,
      fullUrl: "http://test.local:4096",
      txt: { path: "/" },
    })
    expect(stop).toBe(1)
    expect(destroy).toBe(1)
  })

  test("stops on idle gap after first result", async () => {
    events.push({
      delay: 10,
      service: {
        name: "opencode-4096",
        host: "first.local",
        port: 4096,
      },
    })
    events.push({
      delay: 120,
      service: {
        name: "opencode-4097",
        host: "second.local",
        port: 4097,
      },
    })

    const list = await find(AbortSignal.timeout(300), 25)

    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe("opencode-4096")
    expect(list[0]?.fullUrl).toBe("http://first.local:4096")
    expect(stop).toBe(1)
    expect(destroy).toBe(1)
  })
})
